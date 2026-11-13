import { and, desc, eq } from "drizzle-orm";
import { chatJson } from "@/lib/ai";
import {
  armarMensaje,
  fechaLarga,
  folioDe,
  formatoDinero,
  partidasDeSugerencia,
  sugerenciaIaSchema,
  type Partida,
} from "@/lib/cotizaciones";
import { getDb, schema } from "@/lib/db";
import { textoDeMensaje } from "@/lib/resumen-traspaso";
import { businessTimezone } from "@/server/analytics/period";
import { getBranding } from "@/server/branding";
import { SendError, sendMediaMessage } from "@/server/inbox/send";
import { generarPdfCotizacion, nombreArchivo } from "./pdf";
import { leerConfig, leerCotizacion, leerLogo, marcarEnviada } from "./store";

type Fila = NonNullable<Awaited<ReturnType<typeof leerCotizacion>>>;

/** El PDF de una cotización guardada (borrador = vista previa con vigencia desde hoy). */
export async function pdfDeCotizacion(organizationId: string, fila: Fila): Promise<{ data: Buffer; nombre: string }> {
  const [branding, logo, zona] = await Promise.all([
    getBranding(organizationId),
    leerLogo(organizationId),
    businessTimezone(organizationId),
  ]);
  const fecha = fila.enviadaEn ?? new Date();
  const venceEn = fila.venceEn ?? new Date(fecha.getTime() + fila.condiciones.vigenciaDias * 86_400_000);
  const folio = folioDe(fila.numero);
  const data = await generarPdfCotizacion({
    folio,
    fecha,
    venceEn,
    cliente: fila.contactoNombre,
    partidas: fila.partidas,
    descuentoPct: Number(fila.descuentoPct),
    notas: fila.notas,
    totales: fila.totales,
    condiciones: fila.condiciones,
    nombreMarca: branding.name,
    acento: branding.accent,
    logo,
    zona,
  });
  return { data, nombre: nombreArchivo(folio, fila.condiciones.negocio.nombre || branding.name) };
}

export type ResultadoEnvio =
  | { ok: true; messageId: string }
  | { ok: false; status: number; codigo: string; detalle: string };

/**
 * Envía la cotización por WhatsApp como documento, con el texto de Ajustes.
 * Solo un borrador; con «sin precio» sin llenar (precio 0) no sale.
 */
export async function enviarCotizacion(organizationId: string, id: string): Promise<ResultadoEnvio> {
  const fila = await leerCotizacion(organizationId, id);
  if (!fila) return { ok: false, status: 404, codigo: "no_existe", detalle: "Cotización no encontrada" };
  if (fila.estado !== "borrador") {
    return { ok: false, status: 409, codigo: "ya_enviada", detalle: "Esa cotización ya se envió" };
  }
  if (!fila.conversationId) {
    return { ok: false, status: 409, codigo: "sin_conversacion", detalle: "La conversación ya no existe" };
  }
  if (fila.partidas.some((p) => p.precio <= 0)) {
    return {
      ok: false,
      status: 422,
      codigo: "sin_precio",
      detalle: "Hay partidas sin precio: llénalas antes de enviar",
    };
  }
  // La vigencia corre desde el envío: el PDF ya lleva las fechas buenas.
  const ahora = new Date();
  const venceEn = new Date(ahora.getTime() + fila.condiciones.vigenciaDias * 86_400_000);
  const paraPdf: Fila = { ...fila, enviadaEn: ahora, venceEn };
  const { data, nombre } = await pdfDeCotizacion(organizationId, paraPdf);
  const zona = await businessTimezone(organizationId);
  const caption = armarMensaje(fila.condiciones.mensaje, {
    nombre: fila.contactoNombre,
    folio: folioDe(fila.numero),
    total: formatoDinero(fila.totales.total, fila.condiciones.moneda ?? "MXN"),
    vigencia: fechaLarga(venceEn, zona),
  }).slice(0, 1024);

  try {
    const r = await sendMediaMessage({
      conversationId: fila.conversationId,
      organizationId,
      file: { data, mimeType: "application/pdf", fileName: nombre },
      caption,
    });
    await marcarEnviada(organizationId, id, {
      messageId: r.messageId,
      vigenciaDias: fila.condiciones.vigenciaDias,
    });
    return { ok: true, messageId: r.messageId };
  } catch (err) {
    if (err instanceof SendError) {
      const status = err.code === "window_closed" ? 409 : err.code === "not_connected" ? 409 : 502;
      return { ok: false, status, codigo: err.code, detalle: err.message };
    }
    throw err;
  }
}

const MAX_MENSAJES_IA = 30;

/**
 * «Que la IA la llene»: lee la plática y propone productos de la lista con
 * sus cantidades. Los precios los pone el CRM (de la lista), nunca la IA.
 */
export async function sugerirPartidas(
  organizationId: string,
  conversationId: string
): Promise<
  | { ok: true; partidas: Partida[]; sinPrecio: number; notas: string }
  | { ok: false; status: number; codigo: string; detalle: string }
> {
  const config = await leerConfig(organizationId);
  const db = getDb();
  const recientes = await db
    .select({
      direction: schema.message.direction,
      type: schema.message.type,
      text: schema.message.text,
    })
    .from(schema.message)
    .where(and(eq(schema.message.organizationId, organizationId), eq(schema.message.conversationId, conversationId)))
    .orderBy(desc(schema.message.createdAt))
    .limit(MAX_MENSAJES_IA);
  if (recientes.length === 0) {
    return { ok: false, status: 422, codigo: "sin_mensajes", detalle: "La conversación no tiene mensajes todavía" };
  }
  const platica = recientes
    .reverse()
    .map((m) => `${m.direction === "in" ? "CLIENTE" : "NEGOCIO"}: ${textoDeMensaje(m.type, m.text)}`)
    .join("\n");
  const lista =
    config.productos.length > 0
      ? config.productos
          .map((p) => `- id=${p.id} | ${p.nombre} | unidad: ${p.unidad}${p.descripcion ? ` | ${p.descripcion}` : ""}`)
          .join("\n")
      : "(el negocio no tiene lista de productos)";

  const system = [
    "Armas el BORRADOR de una cotización a partir de una conversación de WhatsApp entre un negocio y su cliente.",
    "Devuelve SOLO JSON con esta forma:",
    '{"partidas":[{"productoId":"id de la lista o null","concepto":"nombre del producto o servicio","cantidad":1}],"notas":"detalles del pedido que el cliente pidió (ubicación, fechas, colores), en una o dos frases"}',
    "Reglas:",
    "- Usa productos de la LISTA siempre que se pueda (copia su id exacto).",
    "- Si el cliente pidió algo que no está en la lista, ponlo con productoId null y un concepto claro.",
    "- La cantidad sale de lo que dijo el cliente; si no la dijo, 1.",
    "- NUNCA incluyas precios, descuentos ni totales.",
    "- Si no hay nada que cotizar, devuelve partidas vacío.",
  ].join("\n");
  const user = `LISTA DE PRODUCTOS:\n${lista}\n\nCONVERSACIÓN (de la más vieja a la más nueva):\n${platica}`;

  const r = await chatJson(
    sugerenciaIaSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { organizationId, judge: true, timeoutMs: 45_000 }
  );
  if (!r.ok) {
    return r.error === "not_configured"
      ? { ok: false, status: 409, codigo: "sin_ia", detalle: "Configura la IA en Ajustes → IA" }
      : { ok: false, status: 502, codigo: "ia_fallo", detalle: "La IA no contestó bien. Intenta de nuevo." };
  }
  const sugerencia = sugerenciaIaSchema.parse(r.data);
  const { partidas, sinPrecio } = partidasDeSugerencia(sugerencia, config.productos);
  if (partidas.length === 0) {
    return { ok: false, status: 422, codigo: "nada", detalle: "La IA no encontró qué cotizar en esta conversación" };
  }
  return { ok: true, partidas, sinPrecio, notas: sugerencia.notas.trim() };
}
