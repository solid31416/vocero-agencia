import { and, desc, eq } from "drizzle-orm";
import { chatJson } from "@/lib/ai";
import {
  armarMensaje,
  fechaLarga,
  folioDe,
  formatoDinero,
  PROMPT_SUGERENCIA,
  partidasDeSugerencia,
  sugerenciaIaSchema,
  type Partida,
} from "@/lib/cotizaciones";
import { getDb, schema } from "@/lib/db";
import { textoDeMensaje } from "@/lib/resumen-traspaso";
import { businessTimezone } from "@/server/analytics/period";
import { getBranding } from "@/server/branding";
import { SendError, sendMediaMessage } from "@/server/inbox/send";
import { fotosParaCotizacion } from "./fotos";
import { generarPdfCotizacion, nombreArchivo } from "./pdf";
import {
  CREADA_POR_AGENTE,
  leerConfig,
  leerCotizacion,
  leerLogo,
  marcarEnviada,
  marcarReemplazada,
} from "./store";
import { LEYENDA_POR_DEFECTO } from "@/lib/vendedor";
import { guardarRespuestaDePrueba } from "@/server/lab/sandbox";
import { montoAlTrato, moverACotizacion } from "./embudo";

type Fila = NonNullable<Awaited<ReturnType<typeof leerCotizacion>>>;

/** El PDF de una cotización guardada (borrador = vista previa con vigencia desde hoy). */
export async function pdfDeCotizacion(organizationId: string, fila: Fila): Promise<{ data: Buffer; nombre: string }> {
  // Las fotos salen de los productos de hoy; las cotizaciones de antes de la
  // opción (sin `fotosEnPdf`) también las llevan.
  const conFotos = fila.condiciones.fotosEnPdf !== false;
  const [branding, logo, zona, fotos] = await Promise.all([
    getBranding(organizationId),
    leerLogo(organizationId),
    businessTimezone(organizationId),
    conFotos
      ? leerConfig(organizationId).then((c) => fotosParaCotizacion(organizationId, fila.partidas, c.productos))
      : Promise.resolve([]),
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
    fotos,
    // La que mandó el agente solo lleva la leyenda del vendedor.
    ...(fila.enviadaPor === CREADA_POR_AGENTE
      ? { leyenda: fila.condiciones.vendedor?.leyenda ?? LEYENDA_POR_DEFECTO }
      : {}),
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
export async function enviarCotizacion(
  organizationId: string,
  id: string,
  /** Módulo de la agencia (vendedor): la manda el agente solo; `esPrueba` = Laboratorio. */
  opciones: { porAgente?: boolean; esPrueba?: boolean } = {}
): Promise<ResultadoEnvio> {
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
  // La vigencia corre desde el envío: el PDF ya lleva las fechas buenas. La
  // que manda el agente solo usa la vigencia (más corta) del vendedor.
  const porAgente = opciones.porAgente === true;
  const vigenciaDias = porAgente
    ? (fila.condiciones.vendedor?.vigenciaDias ?? fila.condiciones.vigenciaDias)
    : fila.condiciones.vigenciaDias;
  const enviadaPor = porAgente ? CREADA_POR_AGENTE : null;
  const ahora = new Date();
  const venceEn = new Date(ahora.getTime() + vigenciaDias * 86_400_000);
  const paraPdf: Fila = { ...fila, enviadaEn: ahora, venceEn, enviadaPor };
  const { data, nombre } = await pdfDeCotizacion(organizationId, paraPdf);
  const zona = await businessTimezone(organizationId);
  // Una corrección lo dice al cliente, para que no se quede con la anterior.
  const previa = fila.reemplazaA ? await leerCotizacion(organizationId, fila.reemplazaA) : null;
  const anterior = previa && previa.conversationId === fila.conversationId ? previa : null;
  const caption = (
    (anterior ? `Te comparto la cotización corregida; reemplaza a la ${folioDe(anterior.numero)}.

` : "") +
    armarMensaje(fila.condiciones.mensaje, {
      nombre: fila.contactoNombre,
      folio: folioDe(fila.numero),
      total: formatoDinero(fila.totales.total, fila.condiciones.moneda ?? "MXN"),
      vigencia: fechaLarga(venceEn, zona),
    })
  ).slice(0, 1024);

  // Laboratorio: no sale nada; queda en el hilo qué se habría mandado.
  if (opciones.esPrueba) {
    const g = await guardarRespuestaDePrueba({
      organizationId,
      conversationId: fila.conversationId,
      text: `📎 [Cotización ${folioDe(fila.numero)} en PDF · ${formatoDinero(fila.totales.total, fila.condiciones.moneda ?? "MXN")}]
${caption}`,
    });
    await marcarEnviada(organizationId, id, { messageId: g.messageId, vigenciaDias, enviadaPor });
    if (anterior) await marcarReemplazada(organizationId, anterior.id);
    return { ok: true, messageId: g.messageId };
  }

  try {
    const r = await sendMediaMessage({
      conversationId: fila.conversationId,
      organizationId,
      file: { data, mimeType: "application/pdf", fileName: nombre },
      caption,
      // Lo manda el agente: no cuenta como que una persona tomó la plática.
      aiGenerated: porAgente,
    });
    await marcarEnviada(organizationId, id, { messageId: r.messageId, vigenciaDias, enviadaPor });
    if (anterior) await marcarReemplazada(organizationId, anterior.id);
    // El trato toma el total como monto si nadie le había puesto uno.
    await montoAlTrato({
      organizationId,
      contactId: fila.contactId,
      conversationId: fila.conversationId,
      total: fila.totales.total,
      moneda: fila.condiciones.moneda ?? "MXN",
      soloSiVacio: true,
    });
    // Y pasa a «Cotización enviada» (la IA no puede ponerla: ver bot/stage.ts).
    await moverACotizacion({
      organizationId,
      contactId: fila.contactId,
      conversationId: fila.conversationId,
      actorUserId: null,
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
  | { ok: true; partidas: Partida[]; sinPrecio: number; notas: string; cliente: string }
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

  const system = PROMPT_SUGERENCIA;
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
  return { ok: true, partidas, sinPrecio, notas: sugerencia.notas.trim(), cliente: sugerencia.cliente.trim() };
}
