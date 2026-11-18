import { eq } from "drizzle-orm";
import { formatoDinero, folioDe, type Partida } from "@/lib/cotizaciones";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { scoped } from "@/lib/db/tenant";
import { normalizeMx } from "@/lib/meta/client";
import { conceptoDeFlete, destinosConTarifa, opcionesDeFlete } from "@/lib/fletes";
import { esLaMismaCotizacion, piezasDelPedido, revisarPedidoDelAgente, type PedidoDelAgente } from "@/lib/vendedor";
import { avisarAlDueno } from "@/server/contador-mensajes/worker";
import { publish } from "@/server/events/bus";
import { crearNotaDelSistema } from "@/server/notas";
import { leerFletes } from "@/server/fletes/store";
import { hoyIso } from "@/server/pedidos/store";
import { leerConfig as leerResumen } from "@/server/resumen-traspaso/store";
import { enviarCotizacion } from "./servicio";
import {
  borradorDeConversacion,
  contactoDeConversacion,
  cotizacionesDelAgenteDesde,
  CREADA_POR_AGENTE,
  guardarBorrador,
  leerConfig,
  listarCotizaciones,
} from "./store";

/**
 * Módulo de la agencia — el agente como vendedor: arma una cotización con los
 * precios del catálogo y, según Ajustes → Ventas → Vendedor, la deja para que
 * una persona la mande o la manda él. Siempre deja una nota interna.
 */

/** Cotizaciones que el agente puede armar por conversación en 24 h. */
export const MAX_COTIZACIONES_AGENTE_DIA = 5;

export type ResultadoAgente =
  | {
      ok: true;
      estado: "enviada" | "por_aprobar";
      folio: string;
      total: string;
      anticipo: string;
      resumen: string;
      /**
       * El flete: «incluido» (del tabulador), «sin_tarifa» (no hay para ese
       * destino), «no_permitido» (el vendedor no cotiza extras) o
       * «sin_destino» (no dijo a dónde va).
       */
      flete: EstadoFlete;
      fleteMonto: string | null;
      /** Era la misma que ya le llegó: no se armó otra (ni se gastó folio). */
      repetida?: boolean;
    }
  | { ok: false; status: number; codigo: string; detalle: string; paraPersona: boolean };

export type EstadoFlete = "incluido" | "sin_tarifa" | "no_permitido" | "sin_destino";

export async function cotizarDelAgente(input: {
  organizationId: string;
  pedido: PedidoDelAgente;
  esPrueba: boolean;
}): Promise<ResultadoAgente> {
  const { organizationId, pedido, esPrueba } = input;
  const config = await leerConfig(organizationId);
  const vendedor = config.vendedor;
  const moneda = config.moneda ?? "MXN";
  // El flete sale del tabulador (Ventas → Fletes), nunca del agente.
  let flete: EstadoFlete = "sin_destino";
  let partidaFlete: Partida | null = null;
  if (pedido.destino?.estado) {
    if (!vendedor.extras.activo) flete = "no_permitido";
    else {
      const fletes = await leerFletes(organizationId);
      const piezas = piezasDelPedido(pedido, config.productos);
      const [mejor] = piezas > 0 ? opcionesDeFlete(fletes, { ...pedido.destino, piezas }, hoyIso()) : [];
      if (mejor) {
        flete = "incluido";
        partidaFlete = {
          productoId: null,
          concepto: conceptoDeFlete(mejor, pedido.destino, fletes.origen),
          descripcion: mejor.dias ? `Entrega estimada: ${mejor.dias}` : "",
          cantidad: 1,
          unidad: "servicio",
          precio: mejor.precio,
        };
      } else flete = "sin_tarifa";
    }
  }
  const revision = revisarPedidoDelAgente(
    pedido,
    config.productos,
    vendedor,
    { ivaPct: config.ivaPct, preciosConIva: config.preciosConIva, anticipoPct: config.anticipoPct },
    partidaFlete
  );
  if (!revision.ok) {
    return {
      ok: false,
      status: revision.paraPersona ? 409 : 422,
      codigo: revision.codigo,
      detalle: revision.detalle,
      paraPersona: revision.paraPersona,
    };
  }

  const conversationId = pedido.conversationId;
  // La misma que ya le llegó hace poco: se le recuerda esa, no se arma otra.
  const previas = await listarCotizaciones(organizationId, { conversationId, limite: 5 });
  const igual = previas.find(
    (c) =>
      c.estado === "enviada" &&
      Date.now() - Date.parse(c.enviadaEn ?? c.createdAt) < 24 * 60 * 60 * 1000 &&
      esLaMismaCotizacion(c, { partidas: revision.partidas, descuentoPct: revision.descuentoPct, cliente: pedido.cliente })
  );
  if (igual) {
    return {
      ok: true,
      estado: "enviada",
      folio: igual.folio,
      total: formatoDinero(igual.totales.total, igual.moneda),
      anticipo: formatoDinero(igual.totales.anticipo, igual.moneda),
      resumen: igual.partidas.map((p) => `${p.cantidad} × ${p.concepto} (${formatoDinero(p.precio, igual.moneda)} c/u)`).join(", "),
      flete: partidaFlete ? "incluido" : flete,
      fleteMonto: partidaFlete ? formatoDinero(partidaFlete.precio, igual.moneda) : null,
      repetida: true,
    };
  }
  const hechas = await cotizacionesDelAgenteDesde(
    organizationId,
    conversationId,
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
  if (hechas >= MAX_COTIZACIONES_AGENTE_DIA) {
    return {
      ok: false,
      status: 409,
      codigo: "limite",
      detalle: "Ya armaste varias cotizaciones hoy para este cliente: que lo vea una persona",
      paraPersona: true,
    };
  }

  // Una a la vez por conversación: si una persona está armando la suya, no se pisa.
  const borrador = await borradorDeConversacion(organizationId, conversationId);
  if (borrador && borrador.creadaPor !== CREADA_POR_AGENTE) {
    return {
      ok: false,
      status: 409,
      codigo: "persona_armando",
      detalle: "Una persona del equipo ya está armando la cotización de este cliente: dile que en un momento se la mandan",
      paraPersona: false,
    };
  }

  const guardada = await guardarBorrador({
    organizationId,
    id: borrador?.id ?? null,
    datos: {
      conversationId,
      partidas: revision.partidas,
      descuentoPct: revision.descuentoPct,
      notas: "",
      cliente: pedido.cliente,
      reemplazaA: null,
    },
    creadaPor: CREADA_POR_AGENTE,
  });
  if (!guardada.ok) {
    return { ok: false, status: 409, codigo: guardada.codigo, detalle: guardada.detalle, paraPersona: true };
  }
  const fila = guardada.fila;
  const folio = folioDe(fila.numero);
  const total = formatoDinero(fila.totales.total, moneda);
  const anticipo = formatoDinero(fila.totales.anticipo, moneda);
  const resumen = fila.partidas
    .map((p) => `${p.cantidad} × ${p.concepto} (${formatoDinero(p.precio, moneda)} c/u)`)
    .join(", ");
  const quien = await nombreDelAgente(organizationId);

  let estado: "enviada" | "por_aprobar" = "por_aprobar";
  if (vendedor.modoEnvio === "sola") {
    const r = await enviarCotizacion(organizationId, fila.id, { porAgente: true, esPrueba });
    if (!r.ok) {
      // No salió (ventana cerrada, WhatsApp caído): queda lista para una persona.
      await crearNotaDelSistema(
        organizationId,
        conversationId,
        `🤖 ${quien} armó la cotización ${folio} por ${total} pero no se pudo mandar (${r.detalle}). Ábrela en «Cotizar» y mándala.`
      ).catch(() => {});
      return { ok: false, status: r.status, codigo: r.codigo, detalle: r.detalle, paraPersona: true };
    }
    estado = "enviada";
  }

  const nota =
    estado === "enviada"
      ? `🤖 ${quien} mandó la cotización ${folio}: ${resumen}. Total ${total}. Si algo está mal, en «Cotizar» dale «Corregir».`
      : `🤖 ${quien} preparó la cotización ${folio}: ${resumen}. Total ${total}. Revísala en «Cotizar» y dale «Enviar por WhatsApp».`;
  await crearNotaDelSistema(organizationId, conversationId, nota).catch((err) =>
    console.warn("[vendedor] no se pudo dejar la nota:", err)
  );
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
  if (vendedor.avisarWhatsapp && !esPrueba) void avisarPorWhatsapp(organizationId, conversationId, nota);

  return {
    ok: true,
    estado,
    folio,
    total,
    anticipo,
    resumen,
    flete,
    fleteMonto: partidaFlete ? formatoDinero(partidaFlete.precio, moneda) : null,
  };
}

async function nombreDelAgente(organizationId: string): Promise<string> {
  const [p] = await getDb()
    .select({ name: schema.agentProfile.name })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1)
    .catch(() => []);
  return p?.name?.trim() || "El agente";
}

/**
 * El aviso por WhatsApp al teléfono del dueño (el de Ajustes → IA → Resumen).
 * Si el dueño ES el cliente de esta conversación (pruebas con su propio
 * número), no se manda: caería en la misma plática que atiende el agente.
 */
async function avisarPorWhatsapp(organizationId: string, conversationId: string, texto: string): Promise<void> {
  try {
    const resumen = await leerResumen(organizationId);
    if (!resumen.telefonoDueno) return;
    const contacto = await contactoDeConversacion(organizationId, conversationId);
    if (!contacto) return;
    const [c] = await getDb()
      .select({ waIdentity: schema.contact.waIdentity })
      .from(schema.contact)
      .where(eq(schema.contact.id, contacto.contactId))
      .limit(1);
    if (c?.waIdentity === normalizeMx(resumen.telefonoDueno)) return;
    const enlace = `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/inbox?conversation=${conversationId}`;
    await avisarAlDueno(
      organizationId,
      { telefonoDueno: resumen.telefonoDueno, plantillaId: null },
      `${texto}\n\nCliente: ${contacto.nombre}\n${enlace}`,
      ""
    );
  } catch (err) {
    console.warn("[vendedor] no se pudo avisar por WhatsApp:", err);
  }
}

/** Lo que el agente recibe en su contexto para vender (o null si no vende). */
export type VendedorParaAgente = {
  /**
   * Fletes: a qué destinos hay tarifa en el tabulador (sin precios ni
   * transportistas). null = no cotiza flete (extras apagados o sin tarifas).
   */
  fletes: { destinos: string[] } | null;
  preciosEnChat: boolean;
  modoEnvio: "aprobar" | "sola";
  moneda: "MXN" | "USD";
  /** «IVA incluido» o «más IVA (16%)». */
  iva: string;
  anticipoPct: number;
  productos: {
    id: string;
    nombre: string;
    precio: string;
    unidad: string;
    descripcion: string;
    /** Extra (flete, instalación): solo se cotiza si `puedeCotizarExtras`. */
    extra: boolean;
  }[];
  puedeCotizarExtras: boolean;
  /** 0 = sin descuentos. */
  descuentoMaxPct: number;
  /** null = sin tope. */
  topeMonto: string | null;
  piezasMax: number | null;
  /** La que dejó lista y espera a una persona, si hay. */
  pendiente: { folio: string; total: string } | null;
};

export async function vendedorParaElAgente(
  organizationId: string,
  conversationId: string
): Promise<VendedorParaAgente | null> {
  const config = await leerConfig(organizationId);
  const v = config.vendedor;
  if (!v.activo) return null;
  const moneda = config.moneda ?? "MXN";
  const productos = config.productos
    .filter((p) => p.precio > 0)
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: formatoDinero(p.precio, moneda),
      unidad: p.unidad,
      descripcion: p.descripcion,
      extra: p.extra,
    }));
  if (!productos.some((p) => !p.extra)) return null;
  const borrador = await borradorDeConversacion(organizationId, conversationId);
  const tabulador = v.extras.activo ? await leerFletes(organizationId).catch(() => null) : null;
  const destinos = tabulador ? destinosConTarifa(tabulador) : [];
  return {
    fletes: destinos.length > 0 ? { destinos: destinos.slice(0, 80) } : null,
    preciosEnChat: v.preciosEnChat,
    modoEnvio: v.modoEnvio,
    moneda,
    iva: config.preciosConIva ? "IVA incluido" : `más IVA (${config.ivaPct}%)`,
    anticipoPct: config.anticipoPct,
    productos,
    puedeCotizarExtras: v.extras.activo,
    descuentoMaxPct: v.descuento.activo ? v.descuento.maxPct : 0,
    topeMonto: v.tope.activo ? formatoDinero(v.tope.monto, moneda) : null,
    piezasMax: v.cantidadMax.activo ? v.cantidadMax.piezas : null,
    pendiente:
      borrador && borrador.creadaPor === CREADA_POR_AGENTE
        ? { folio: folioDe(borrador.numero), total: formatoDinero(borrador.totales.total, moneda) }
        : null,
  };
}

/** La última cotización que ya le llegó al cliente, para que el agente sepa qué acepta. */
export type CotizacionParaAgente = {
  folio: string;
  /** enviada | aceptada | vencida (visible). */
  estado: string;
  total: string;
  anticipo: string | null;
  resumen: string;
  venceEn: string | null;
};

/**
 * Módulo de la agencia — la cotización vigente de la conversación (la última
 * enviada, aceptada o vencida; la hiciera una persona o el agente). Sin ella,
 * el agente leía el «sí» del cliente al PDF («para apartar, responde SÍ») como
 * un sí a una cita (prueba del dueño, 2026-11-17).
 */
export async function cotizacionParaElAgente(
  organizationId: string,
  conversationId: string
): Promise<CotizacionParaAgente | null> {
  const lista = await listarCotizaciones(organizationId, { conversationId, limite: 10 });
  const c = lista.find((x) => x.estado === "enviada" || x.estado === "aceptada" || x.estado === "vencida");
  if (!c) return null;
  return {
    folio: c.folio,
    estado: c.estado,
    total: formatoDinero(c.totales.total, c.moneda),
    anticipo: c.totales.anticipo > 0 && c.totales.anticipo < c.totales.total ? formatoDinero(c.totales.anticipo, c.moneda) : null,
    resumen: c.partidas.map((p) => `${p.cantidad} × ${p.concepto}`).join(", "),
    venceEn: c.venceEn,
  };
}
