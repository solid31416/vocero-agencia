import { eq } from "drizzle-orm";
import { formatoDinero, folioDe } from "@/lib/cotizaciones";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { scoped } from "@/lib/db/tenant";
import { normalizeMx } from "@/lib/meta/client";
import { revisarPedidoDelAgente, type PedidoDelAgente } from "@/lib/vendedor";
import { avisarAlDueno } from "@/server/contador-mensajes/worker";
import { publish } from "@/server/events/bus";
import { crearNotaDelSistema } from "@/server/notas";
import { leerConfig as leerResumen } from "@/server/resumen-traspaso/store";
import { enviarCotizacion } from "./servicio";
import {
  borradorDeConversacion,
  contactoDeConversacion,
  cotizacionesDelAgenteDesde,
  CREADA_POR_AGENTE,
  guardarBorrador,
  leerConfig,
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
    }
  | { ok: false; status: number; codigo: string; detalle: string; paraPersona: boolean };

export async function cotizarDelAgente(input: {
  organizationId: string;
  pedido: PedidoDelAgente;
  esPrueba: boolean;
}): Promise<ResultadoAgente> {
  const { organizationId, pedido, esPrueba } = input;
  const config = await leerConfig(organizationId);
  const vendedor = config.vendedor;
  const revision = revisarPedidoDelAgente(pedido, config.productos, vendedor, {
    ivaPct: config.ivaPct,
    preciosConIva: config.preciosConIva,
    anticipoPct: config.anticipoPct,
  });
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
  const moneda = config.moneda ?? "MXN";
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

  return { ok: true, estado, folio, total, anticipo, resumen };
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
  return {
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
