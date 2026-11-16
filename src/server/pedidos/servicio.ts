import { and, asc, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { formatoDinero } from "@/lib/cotizaciones";
import {
  MAX_PAGOS,
  armarMensaje,
  etapaDeAnticipo,
  folioDe,
  mensajeDePago,
  resumenPagos,
  resumenParaFicha,
  tipoDePago,
  variablesPlantilla,
  type AvisoHistorial,
  type Cambio,
  type ConfigPedidos,
  type Etapa,
  type Movimiento,
  type Pago,
  type PagoInput,
  type PedidoInput,
} from "@/lib/pedidos";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { upsertFicha } from "@/server/bot/ficha";
import { sendText, SendError } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import {
  actualizarPedido,
  contactoDeConversacion,
  insertarPedido,
  leerConfig,
  leerPedido,
  type FilaPedido,
} from "./store";

/**
 * Módulo de la agencia — crear un pedido, moverlo de etapa y avisarle al
 * cliente. Un aviso que no sale (ventana cerrada sin plantilla, Meta caído)
 * jamás impide el cambio de etapa: queda anotado en el historial.
 */

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; codigo: string; detalle: string };

async function avisar(
  organizationId: string,
  config: ConfigPedidos,
  f: FilaPedido,
  texto: string
): Promise<{ aviso: AvisoHistorial; detalle: string | null }> {
  if (!f.conversationId) return { aviso: "no", detalle: "El pedido ya no tiene conversación" };
  if (!texto.trim()) return { aviso: "no", detalle: "Esta etapa no tiene mensaje" };
  try {
    await sendText({ organizationId, conversationId: f.conversationId, text: texto });
    return { aviso: "texto", detalle: null };
  } catch (err) {
    if (!(err instanceof SendError && err.code === "window_closed")) {
      return { aviso: "fallo", detalle: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!config.plantillaId) {
    return { aviso: "no", detalle: "Ventana de 24 h cerrada y sin plantilla elegida en Ajustes → Pedidos" };
  }
  try {
    await sendTemplate({
      organizationId,
      conversationId: f.conversationId,
      templateId: config.plantillaId,
      variables: variablesPlantilla(f.contactoNombre, folioDe(f.numero), f.etapaNombre),
    });
    return { aviso: "plantilla", detalle: "Con plantilla (ventana cerrada)" };
  } catch (err) {
    return { aviso: "fallo", detalle: err instanceof Error ? err.message : String(err) };
  }
}

/** Anota el estado en la ficha del contacto (el agente la lee en cada turno). Nunca truena. */
async function anotarEnFicha(organizationId: string, config: ConfigPedidos, f: FilaPedido): Promise<void> {
  if (!config.actualizarFicha || !f.contactId) return;
  const ultima = config.etapas[config.etapas.length - 1]?.id === f.etapaId;
  const monto = f.monto === null ? null : Number(f.monto);
  const pagos = Array.isArray(f.pagos) ? f.pagos : [];
  const r = resumenPagos(monto, pagos);
  await upsertFicha({
    organizationId,
    contactId: f.contactId,
    ficha: {
      [`Pedido ${folioDe(f.numero)}`]: resumenParaFicha({
        folio: folioDe(f.numero),
        concepto: f.concepto,
        etapaNombre: f.etapaNombre,
        fechaEstimada: f.fechaEstimada,
        esUltima: ultima,
        pagos:
          pagos.length > 0
            ? {
                pagado: formatoDinero(r.pagado),
                saldo: r.saldo !== null && r.saldo > 0 ? formatoDinero(r.saldo) : null,
                liquidado: r.liquidado,
              }
            : null,
      }),
    },
  }).catch((err) => console.warn("[pedidos] no se pudo anotar en la ficha:", err));
}

export async function crearPedido(
  organizationId: string,
  datos: PedidoInput,
  userId: string | null
): Promise<Resultado<FilaPedido>> {
  const contacto = await contactoDeConversacion(organizationId, datos.conversationId);
  if (!contacto) return { ok: false, status: 404, codigo: "not_found", detalle: "Conversación no encontrada" };
  const config = await leerConfig(organizationId);
  const primera = config.etapas[0]!;
  const ahora = new Date().toISOString();
  const f = await insertarPedido({
    organizationId,
    conversationId: datos.conversationId,
    contactId: contacto.contactId,
    contactoNombre: contacto.nombre,
    concepto: datos.concepto,
    monto: datos.monto,
    fechaEstimada: datos.fechaEstimada,
    etapaId: primera.id,
    etapaNombre: primera.nombre,
    historial: [],
    cotizacionId: datos.cotizacionId,
    notas: datos.notas,
    creadoPor: userId,
  });
  if (!f) return { ok: false, status: 409, codigo: "ocupado", detalle: "No se pudo apartar el folio; intenta de nuevo" };

  const aviso =
    datos.avisar && !contacto.isTest
      ? await avisar(organizationId, config, f, mensajeDeEtapa(primera, f))
      : { aviso: "no" as const, detalle: contacto.isTest ? "Conversación de prueba" : null };
  const mov: Movimiento = { etapaId: primera.id, etapaNombre: primera.nombre, en: ahora, nota: "", ...aviso, por: userId };
  const final = (await actualizarPedido(organizationId, f.id, { historial: [mov] })) ?? f;
  await anotarEnFicha(organizationId, config, final);
  return { ok: true, valor: final };
}

function mensajeDeEtapa(etapa: Etapa, f: FilaPedido): string {
  return armarMensaje(etapa.mensaje, {
    contacto: f.contactoNombre,
    folio: folioDe(f.numero),
    estado: etapa.nombre,
    fechaEstimada: f.fechaEstimada,
    concepto: f.concepto,
  });
}

/** Cambia datos del pedido y, si viene `etapaId`, lo mueve de etapa (y avisa si se pidió). */
export async function cambiarPedido(
  organizationId: string,
  id: string,
  cambio: Cambio,
  userId: string | null
): Promise<Resultado<FilaPedido>> {
  const previo = await leerPedido(organizationId, id);
  if (!previo) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  const config = await leerConfig(organizationId);

  const datos: Partial<FilaPedido> = {};
  if (cambio.concepto !== undefined) datos.concepto = cambio.concepto;
  if (cambio.monto !== undefined) datos.monto = cambio.monto;
  if (cambio.fechaEstimada !== undefined) datos.fechaEstimada = cambio.fechaEstimada;
  if (cambio.cobrarSaldoEl !== undefined) datos.cobrarSaldoEl = cambio.cobrarSaldoEl;
  let f = { ...previo, ...datos };

  if (cambio.etapaId) {
    const etapa = config.etapas.find((e) => e.id === cambio.etapaId);
    if (!etapa) return { ok: false, status: 422, codigo: "etapa_invalida", detalle: "Esa etapa ya no existe" };
    f = { ...f, etapaId: etapa.id, etapaNombre: etapa.nombre };
    const contacto = f.conversationId ? await contactoDeConversacion(organizationId, f.conversationId) : null;
    const texto = cambio.mensaje ?? mensajeDeEtapa(etapa, f);
    const aviso =
      cambio.avisar && !contacto?.isTest
        ? await avisar(organizationId, config, f, texto)
        : { aviso: "no" as const, detalle: contacto?.isTest ? "Conversación de prueba" : null };
    const mov: Movimiento = {
      etapaId: etapa.id,
      etapaNombre: etapa.nombre,
      en: new Date().toISOString(),
      nota: cambio.nota,
      ...aviso,
      por: userId,
    };
    datos.etapaId = etapa.id;
    datos.etapaNombre = etapa.nombre;
    datos.historial = [...previo.historial, mov].slice(-100);
  }

  const final = await actualizarPedido(organizationId, id, datos);
  if (!final) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  await anotarEnFicha(organizationId, config, final);
  return { ok: true, valor: final };
}

/** Lo quita de la lista (borrado suave) y de la ficha del contacto. */
export async function borrarPedido(organizationId: string, id: string): Promise<boolean> {
  const f = await leerPedido(organizationId, id);
  if (!f) return false;
  await actualizarPedido(organizationId, id, { borrado: true });
  if (f.contactId) {
    await upsertFicha({ organizationId, contactId: f.contactId, ficha: { [`Pedido ${folioDe(f.numero)}`]: null } }).catch(
      () => null
    );
  }
  return true;
}

/* ------------------------------------------------------------------
 * Anticipo y saldo
 * ------------------------------------------------------------------ */

const nanoPago = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

/**
 * El primer pago (el anticipo) pasa al lead a la etapa «Anticipo…» del
 * embudo, si el negocio tiene una y el lead todavía no llega ahí. Nunca
 * truena: el pago ya quedó guardado.
 */
async function moverAAnticipo(organizationId: string, contactId: string, userId: string | null): Promise<string | null> {
  try {
    const db = getDb();
    const etapas = await db
      .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind, position: schema.pipelineStage.position })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId))
      .orderBy(asc(schema.pipelineStage.position));
    const destino = etapaDeAnticipo(etapas);
    if (!destino) return null;
    const [lead] = await db
      .select({ id: schema.lead.id, stageId: schema.lead.stageId })
      .from(schema.lead)
      .where(and(eq(schema.lead.organizationId, organizationId), eq(schema.lead.contactId, contactId)))
      .limit(1);
    if (!lead) return null;
    const actual = etapas.find((e) => e.id === lead.stageId);
    // Si ya va en esa etapa o más adelante (o en ganado/perdido), no se mueve.
    if (actual && (actual.kind !== "open" || actual.position >= destino.position)) return null;
    const r = await moveLeadToStage({
      organizationId,
      leadId: lead.id,
      toStageId: destino.id,
      actorUserId: userId,
      source: userId ? "dueno" : "sistema",
    });
    return r.ok && r.changed ? destino.name : null;
  } catch (err) {
    console.warn("[pedidos] no se pudo mover el lead a la etapa de anticipo:", err);
    return null;
  }
}

export type ResultadoPago = {
  pedido: FilaPedido;
  /** Si el lead pasó de etapa en el embudo, a cuál. */
  etapaEmbudo: string | null;
  aviso: { aviso: AvisoHistorial; detalle: string | null } | null;
};

/** Registra un pago (anticipo, abono o liquidación) y, si se pide, le avisa al cliente. */
export async function registrarPago(
  organizationId: string,
  id: string,
  datos: PagoInput,
  userId: string | null,
  hoy: string
): Promise<Resultado<ResultadoPago>> {
  const previo = await leerPedido(organizationId, id);
  if (!previo) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  const previos = Array.isArray(previo.pagos) ? previo.pagos : [];
  if (previos.length >= MAX_PAGOS) {
    return { ok: false, status: 409, codigo: "lleno", detalle: `Máximo ${MAX_PAGOS} pagos por pedido` };
  }
  const monto = previo.monto === null ? null : Number(previo.monto);
  const pago: Pago = {
    id: `pag_${nanoPago()}`,
    monto: Math.round(datos.monto * 100) / 100,
    fecha: datos.fecha ?? hoy,
    nota: datos.nota,
    tipo: tipoDePago(monto, previos, datos.monto),
    por: userId,
    creadoEn: new Date().toISOString(),
  };
  const pagos = [...previos, pago];
  const final = await actualizarPedido(organizationId, id, { pagos });
  if (!final) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  const config = await leerConfig(organizationId);
  await anotarEnFicha(organizationId, config, final);

  const etapaEmbudo = previos.length === 0 && final.contactId ? await moverAAnticipo(organizationId, final.contactId, userId) : null;

  let aviso: ResultadoPago["aviso"] = null;
  if (datos.avisar) {
    const contacto = final.conversationId ? await contactoDeConversacion(organizationId, final.conversationId) : null;
    if (contacto?.isTest) {
      aviso = { aviso: "no", detalle: "Conversación de prueba" };
    } else {
      const r = resumenPagos(monto, pagos);
      const texto =
        datos.mensaje ??
        mensajeDePago({
          contacto: final.contactoNombre,
          folio: folioDe(final.numero),
          monto: formatoDinero(pago.monto),
          saldo: r.saldo !== null && r.saldo > 0 ? formatoDinero(r.saldo) : null,
          liquidado: r.liquidado,
        });
      aviso = await avisar(organizationId, config, final, texto);
    }
  }
  return { ok: true, valor: { pedido: final, etapaEmbudo, aviso } };
}

/** Quita un pago capturado por error. */
export async function quitarPago(organizationId: string, id: string, pagoId: string): Promise<Resultado<FilaPedido>> {
  const previo = await leerPedido(organizationId, id);
  if (!previo) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  const previos = Array.isArray(previo.pagos) ? previo.pagos : [];
  if (!previos.some((p) => p.id === pagoId)) {
    return { ok: false, status: 404, codigo: "not_found", detalle: "Ese pago ya no está" };
  }
  // Los tipos se recalculan: si se quita el anticipo, el siguiente pasa a serlo.
  const monto = previo.monto === null ? null : Number(previo.monto);
  const quedan: Pago[] = [];
  for (const p of previos.filter((x) => x.id !== pagoId)) quedan.push({ ...p, tipo: tipoDePago(monto, quedan, p.monto) });
  const final = await actualizarPedido(organizationId, id, { pagos: quedan });
  if (!final) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  await anotarEnFicha(organizationId, await leerConfig(organizationId), final);
  return { ok: true, valor: final };
}
