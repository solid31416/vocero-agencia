import { and, asc, desc, eq, gt, inArray, ne, or } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { chatJson } from "@/lib/ai";
import {
  PROMPT_ACEPTACION,
  folioDe,
  pistaDeAceptacion,
  productoPrincipal,
  respuestaAceptacionSchema,
  siguienteToque,
  textoDeSeguimiento,
  toqueQueToca,
  type ConfigCotizaciones,
  type SeguimientoCotDto,
  type Toque,
} from "@/lib/cotizaciones";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { textoDeMensaje } from "@/lib/resumen-traspaso";
import { publish } from "@/server/events/bus";
import { SendError, sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import { cotizacionesEnabled } from "./flag";
import { asegurarTablas, cotizacion, cotizacionToque, leerConfig } from "./store";

/**
 * Módulo de la agencia — el revisor de cotizaciones enviadas. Cada 2 minutos,
 * en el mismo proceso (sin colas):
 *
 * 1. **El «sí» del cliente.** Si el cliente escribió después de recibir la
 *    cotización y lo que dijo huele a aceptar («va, lo quiero», «¿a qué cuenta
 *    deposito?»), la IA barata lo confirma y la cotización queda con una
 *    señal: la bandeja ofrece «Marcar aceptada» con un clic. Nunca la acepta
 *    sola.
 * 2. **Seguimiento sin respuesta.** Si el cliente no ha contestado nada desde
 *    que la recibió: un recordatorio de texto antes de que se cierre la
 *    ventana de 24 h y, si hay plantilla, otro a los N días. Se detiene en
 *    cuanto contesta, se acepta o rechaza, vence, o alguien lo detiene.
 *
 * Solo la cotización enviada más reciente de cada conversación, solo
 * WhatsApp, nunca el Laboratorio ni un cliente en Ganado/Perdido. Un fallo
 * aquí jamás tumba nada.
 */

const INTERVALO_MS = 2 * 60_000;
const DIA_MS = 86_400_000;
/** Cotizaciones enviadas hace más de esto ya no se revisan. */
const ANTIGUEDAD_MAX_MS = 45 * DIA_MS;
/** Que el cliente termine de escribir antes de leerlo. */
const CALMA_MS = 60_000;
const MAX_MENSAJES_IA = 16;

const nanoToque = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __voceroRevisorCot?: Estado };
function estado(): Estado {
  g.__voceroRevisorCot ??= { timer: null, corriendo: false };
  return g.__voceroRevisorCot;
}

export function iniciarRevisorCotizaciones(): void {
  if (!cotizacionesEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaCotizaciones(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[cotizaciones] revisor encendido (cada 2 minutos): el «sí» del cliente y el seguimiento");
}

type Candidata = {
  cot: typeof cotizacion.$inferSelect;
  lastInboundAt: Date | null;
  isTest: boolean;
  channel: string;
  contactId: string;
};

/** La cotización enviada más reciente de cada conversación, de los últimos 45 días. */
async function candidatas(organizationId: string, ahora: Date): Promise<Candidata[]> {
  const db = getDb();
  const filas = await db
    .select({
      cot: cotizacion,
      lastInboundAt: schema.conversation.lastInboundAt,
      isTest: schema.conversation.isTest,
      channel: schema.conversation.channel,
      contactId: schema.conversation.contactId,
    })
    .from(cotizacion)
    .innerJoin(schema.conversation, eq(schema.conversation.id, cotizacion.conversationId))
    .where(
      and(
        eq(cotizacion.organizationId, organizationId),
        eq(cotizacion.estado, "enviada"),
        gt(cotizacion.enviadaEn, new Date(ahora.getTime() - ANTIGUEDAD_MAX_MS))
      )
    )
    .orderBy(desc(cotizacion.enviadaEn))
    .limit(300);
  const vistas = new Set<string>();
  const out: Candidata[] = [];
  for (const f of filas) {
    if (!f.cot.conversationId || vistas.has(f.cot.conversationId)) continue;
    vistas.add(f.cot.conversationId);
    out.push(f);
  }
  return out;
}

async function organizacionesConCotizaciones(): Promise<{ organizationId: string; config: ConfigCotizaciones }[]> {
  const filas = await getDb()
    .selectDistinct({ organizationId: cotizacion.organizationId })
    .from(cotizacion)
    .where(eq(cotizacion.estado, "enviada"));
  const out: { organizationId: string; config: ConfigCotizaciones }[] = [];
  for (const f of filas) out.push({ organizationId: f.organizationId, config: await leerConfig(f.organizationId) });
  return out;
}

/** Una pasada. Exportada para correrla a mano. */
export async function tandaCotizaciones(ahora = new Date()): Promise<{ senales: number; recordatorios: number }> {
  const e = estado();
  const r = { senales: 0, recordatorios: 0 };
  if (e.corriendo) return r;
  e.corriendo = true;
  try {
    await asegurarTablas();
    for (const { organizationId, config } of await organizacionesConCotizaciones()) {
      if (!config.detectarSi && !config.seguimiento.activo) continue;
      try {
        for (const c of await candidatas(organizationId, ahora)) {
          if (c.isTest) continue;
          if (config.detectarSi && (await revisarSenal(organizationId, c, ahora))) r.senales += 1;
          if (config.seguimiento.activo && c.channel === "whatsapp") {
            const t = await revisarSeguimiento(organizationId, config, c, ahora);
            if (t === "enviado") r.recordatorios += 1;
          }
        }
      } catch (err) {
        console.error(`[cotizaciones] revisor ${organizationId}:`, err);
      }
    }
  } catch (err) {
    console.error("[cotizaciones] la tanda falló:", err);
  } finally {
    e.corriendo = false;
  }
  return r;
}

/* ------------------------------------------------------------------
 * 1. El «sí» del cliente
 * ------------------------------------------------------------------ */

async function revisarSenal(organizationId: string, c: Candidata, ahora: Date): Promise<boolean> {
  const { cot } = c;
  if (!cot.enviadaEn || !c.lastInboundAt || cot.senalEn) return false;
  if (c.lastInboundAt.getTime() <= cot.enviadaEn.getTime()) return false;
  if (cot.senalRevisadaHasta && c.lastInboundAt.getTime() <= cot.senalRevisadaHasta.getTime()) return false;
  if (ahora.getTime() - c.lastInboundAt.getTime() < CALMA_MS) return false;

  const db = getDb();
  const desde =
    cot.senalRevisadaHasta && cot.senalRevisadaHasta > cot.enviadaEn ? cot.senalRevisadaHasta : cot.enviadaEn;
  const nuevos = await db
    .select({ type: schema.message.type, text: schema.message.text })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, cot.conversationId!),
        eq(schema.message.direction, "in"),
        gt(schema.message.createdAt, desde)
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(30);
  const marcarRevisada = () =>
    db
      .update(cotizacion)
      .set({ senalRevisadaHasta: c.lastInboundAt })
      .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, cot.id)));

  const textos = nuevos.map((m) => (m.text ?? "").trim()).filter(Boolean);
  const pistas = textos.map((t) => ({ t, p: pistaDeAceptacion(t) })).filter((x) => x.p);
  if (pistas.length === 0) {
    await marcarRevisada();
    return false;
  }

  // La IA (modelo «juez», el barato) decide con la plática desde que salió la cotización.
  const platica = await db
    .select({ direction: schema.message.direction, type: schema.message.type, text: schema.message.text })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, cot.conversationId!),
        gt(schema.message.createdAt, new Date(cot.enviadaEn.getTime() - 60_000))
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(MAX_MENSAJES_IA);
  const resumen = cot.partidas.map((p) => `${p.cantidad} × ${p.concepto}`).join(", ");
  const r = await chatJson(
    respuestaAceptacionSchema,
    [
      { role: "system", content: PROMPT_ACEPTACION },
      {
        role: "user",
        content:
          `COTIZACIÓN ${folioDe(cot.numero)}: ${resumen}\n\nMENSAJES (del más viejo al más nuevo):\n` +
          platica
            .reverse()
            .map((m) => `${m.direction === "in" ? "CLIENTE" : "NEGOCIO"}: ${textoDeMensaje(m.type, m.text)}`)
            .join("\n"),
      },
    ],
    { organizationId, judge: true, timeoutMs: 30_000 }
  ).catch(() => null);

  let frase: string | null = null;
  if (r?.ok) {
    const d = respuestaAceptacionSchema.safeParse(r.data);
    if (d.success && d.data.acepta) frase = d.data.frase.trim() || pistas[pistas.length - 1]!.t;
  } else {
    // Sin IA (o la IA falló): solo las frases que casi siempre son un «sí».
    const fuerte = pistas.filter((x) => x.p === "fuerte");
    if (fuerte.length > 0) frase = fuerte[fuerte.length - 1]!.t;
  }

  if (!frase) {
    await marcarRevisada();
    return false;
  }
  await db
    .update(cotizacion)
    .set({ senalTexto: frase.slice(0, 300), senalEn: ahora, senalRevisadaHasta: c.lastInboundAt })
    .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, cot.id)));
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: cot.conversationId } } });
  console.log(`[cotizaciones] ${folioDe(cot.numero)}: el cliente parece aceptar`);
  return true;
}

/** «No era eso»: se quita la señal (y se sigue revisando lo que escriba después). */
export async function descartarSenal(organizationId: string, id: string): Promise<boolean> {
  await asegurarTablas();
  const filas = await getDb()
    .update(cotizacion)
    .set({ senalTexto: null, senalEn: null })
    .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, id)))
    .returning({ id: cotizacion.id });
  return filas.length > 0;
}

/* ------------------------------------------------------------------
 * 2. Seguimiento sin respuesta
 * ------------------------------------------------------------------ */

async function toquesDe(organizationId: string, cotizacionIds: string[]) {
  if (cotizacionIds.length === 0) return [];
  return getDb()
    .select()
    .from(cotizacionToque)
    .where(
      and(eq(cotizacionToque.organizationId, organizationId), inArray(cotizacionToque.cotizacionId, cotizacionIds))
    )
    .orderBy(asc(cotizacionToque.createdAt));
}

/** Por qué una cotización enviada NO lleva seguimiento (null = sí lo lleva). */
async function motivoSinSeguimiento(
  organizationId: string,
  c: Candidata,
  ahora: Date
): Promise<string | null> {
  const { cot } = c;
  if (c.isTest) return "Es una conversación del Laboratorio";
  if (c.channel !== "whatsapp") return "El seguimiento solo funciona en WhatsApp";
  if (cot.seguimientoPausado) return "Lo detuviste para esta cotización";
  if (cot.venceEn && cot.venceEn.getTime() < ahora.getTime()) return "La cotización ya venció";
  if (cot.enviadaEn && c.lastInboundAt && c.lastInboundAt.getTime() > cot.enviadaEn.getTime()) {
    return "El cliente ya contestó";
  }
  const [etapa] = await getDb()
    .select({ kind: schema.pipelineStage.kind, nombre: schema.pipelineStage.name })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, c.contactId)))
    .limit(1);
  if (etapa && etapa.kind !== "open") return `Está en «${etapa.nombre}»`;
  return null;
}

/** ¿Alguien (una persona o el agente) ya le escribió después de la cotización? */
async function salioAlgoDespues(organizationId: string, conversationId: string, desde: Date): Promise<boolean> {
  const [m] = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        gt(schema.message.createdAt, desde)
      )
    )
    .limit(1);
  return Boolean(m);
}

async function revisarSeguimiento(
  organizationId: string,
  config: ConfigCotizaciones,
  c: Candidata,
  ahora: Date
): Promise<"enviado" | null> {
  const { cot } = c;
  if (!cot.enviadaEn || !cot.conversationId) return null;
  if (await motivoSinSeguimiento(organizationId, c, ahora)) return null;
  const hechos = (await toquesDe(organizationId, [cot.id])).map((t) => ({ toque: t.toque, en: t.createdAt }));
  const toque = toqueQueToca({
    ahora,
    enviadaEn: cot.enviadaEn,
    ultimoDelCliente: c.lastInboundAt,
    hechos,
    config: config.seguimiento,
  });
  if (!toque) return null;

  // Si alguien ya le escribió (después de los mensajes que acompañan al PDF),
  // la plática sigue viva: el texto no sale, y la plantilla espera.
  const ultimoToque = hechos.length > 0 ? hechos[hechos.length - 1]!.en : null;
  const desde =
    toque === "texto"
      ? new Date(cot.enviadaEn.getTime() + 10 * 60_000)
      : new Date(Math.max(ahora.getTime() - 20 * 3_600_000, (ultimoToque ?? cot.enviadaEn).getTime() + 60_000));
  if (await salioAlgoDespues(organizationId, cot.conversationId, desde)) return null;

  const r = await mandarToque(organizationId, config, cot, toque);
  return r.estado === "enviado" ? "enviado" : null;
}

/** Aparta el toque (uno de cada tipo por cotización), lo manda y deja constancia. */
async function mandarToque(
  organizationId: string,
  config: ConfigCotizaciones,
  cot: typeof cotizacion.$inferSelect,
  toque: Toque
): Promise<{ estado: "enviado" | "omitido" | "fallido" | "ya"; detalle: string | null }> {
  const db = getDb();
  const id = `toq_${nanoToque()}`;
  const apartado = await db
    .insert(cotizacionToque)
    .values({ id, organizationId, cotizacionId: cot.id, conversationId: cot.conversationId, toque, estado: "enviando" })
    .onConflictDoNothing()
    .returning({ id: cotizacionToque.id });
  if (apartado.length === 0) return { estado: "ya", detalle: "Ese recordatorio ya salió" };

  const datos = {
    nombre: cot.contactoNombre,
    producto: productoPrincipal(cot.partidas),
    folio: folioDe(cot.numero),
  };
  let estadoFinal: "enviado" | "omitido" | "fallido";
  let detalle: string | null = null;
  try {
    if (toque === "texto") {
      await sendText({
        organizationId,
        conversationId: cot.conversationId!,
        text: textoDeSeguimiento(config.seguimiento.texto, datos),
      });
      estadoFinal = "enviado";
      detalle = "Texto (dentro de las 24 h)";
    } else if (!config.seguimiento.plantillaId) {
      estadoFinal = "omitido";
      detalle = "Sin plantilla elegida en Ajustes → Cotizaciones → Seguimiento";
    } else {
      await sendTemplate({
        organizationId,
        conversationId: cot.conversationId!,
        templateId: config.seguimiento.plantillaId,
        variables: [datos.nombre.trim().split(/\s+/)[0] || "👋", datos.producto],
      });
      estadoFinal = "enviado";
      detalle = "Con plantilla";
    }
  } catch (err) {
    estadoFinal = err instanceof SendError && err.code === "window_closed" ? "omitido" : "fallido";
    detalle =
      err instanceof SendError && err.code === "window_closed"
        ? "Se cerró la ventana de 24 h antes de mandarlo"
        : err instanceof Error
          ? err.message.slice(0, 300)
          : String(err).slice(0, 300);
  }
  await db.update(cotizacionToque).set({ estado: estadoFinal, detalle }).where(eq(cotizacionToque.id, id));
  if (estadoFinal === "enviado") {
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: cot.conversationId } } });
  }
  return { estado: estadoFinal, detalle };
}

/**
 * «Mandar recordatorio ahora» desde la tarjeta: texto si la ventana sigue
 * abierta; si no, la plantilla. Cuenta como el toque que corresponda.
 */
export async function recordarAhora(
  organizationId: string,
  id: string
): Promise<{ ok: true; detalle: string } | { ok: false; status: number; detalle: string }> {
  await asegurarTablas();
  const [f] = await getDb()
    .select({ cot: cotizacion, lastInboundAt: schema.conversation.lastInboundAt })
    .from(cotizacion)
    .innerJoin(schema.conversation, eq(schema.conversation.id, cotizacion.conversationId))
    .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, id)))
    .limit(1);
  if (!f) return { ok: false, status: 404, detalle: "Cotización no encontrada" };
  if (f.cot.estado !== "enviada") return { ok: false, status: 409, detalle: "Solo a cotizaciones enviadas" };
  const config = await leerConfig(organizationId);
  const abierta = f.lastInboundAt && Date.now() - f.lastInboundAt.getTime() < DIA_MS - 5 * 60_000;
  const hechos = (await toquesDe(organizationId, [id])).filter((t) => t.estado === "enviado").map((t) => t.toque);
  let toque: Toque;
  if (abierta && !hechos.includes("texto")) toque = "texto";
  else if (!hechos.includes("plantilla")) toque = "plantilla";
  else return { ok: false, status: 409, detalle: "Ya salieron los dos recordatorios de esta cotización" };
  if (toque === "plantilla" && !config.seguimiento.plantillaId) {
    return {
      ok: false,
      status: 409,
      detalle: "Pasaron más de 24 h: hace falta una plantilla (Ajustes → Cotizaciones → Seguimiento)",
    };
  }
  // Un intento anterior que no salió (omitido o fallido) se vuelve a intentar.
  await getDb()
    .delete(cotizacionToque)
    .where(
      and(
        eq(cotizacionToque.organizationId, organizationId),
        eq(cotizacionToque.cotizacionId, id),
        eq(cotizacionToque.toque, toque),
        ne(cotizacionToque.estado, "enviado")
      )
    );
  const r = await mandarToque(organizationId, config, f.cot, toque);
  if (r.estado === "enviado") return { ok: true, detalle: toque === "texto" ? "Recordatorio enviado" : "Recordatorio enviado con plantilla" };
  return { ok: false, status: r.estado === "ya" ? 409 : 502, detalle: r.detalle ?? "No se pudo mandar" };
}

export async function pausarSeguimiento(organizationId: string, id: string, pausado: boolean): Promise<boolean> {
  await asegurarTablas();
  const filas = await getDb()
    .update(cotizacion)
    .set({ seguimientoPausado: pausado })
    .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, id)))
    .returning({ id: cotizacion.id });
  return filas.length > 0;
}

/** Cómo va el seguimiento de las cotizaciones de una conversación (para la bandeja). */
export async function seguimientosDeConversacion(
  organizationId: string,
  conversationId: string,
  ahora = new Date()
): Promise<Record<string, SeguimientoCotDto>> {
  await asegurarTablas();
  const db = getDb();
  const [conv] = await db
    .select({
      lastInboundAt: schema.conversation.lastInboundAt,
      isTest: schema.conversation.isTest,
      channel: schema.conversation.channel,
      contactId: schema.conversation.contactId,
    })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conv) return {};
  const cots = await db
    .select()
    .from(cotizacion)
    .where(
      scoped(
        cotizacion.organizationId,
        organizationId,
        eq(cotizacion.conversationId, conversationId),
        or(eq(cotizacion.estado, "enviada"), eq(cotizacion.estado, "aceptada"), eq(cotizacion.estado, "rechazada"))
      )
    )
    .orderBy(desc(cotizacion.enviadaEn))
    .limit(20);
  if (cots.length === 0) return {};
  const config = await leerConfig(organizationId);
  const toques = await toquesDe(
    organizationId,
    cots.map((c) => c.id)
  );
  const out: Record<string, SeguimientoCotDto> = {};
  const masReciente = cots.find((c) => c.estado === "enviada")?.id ?? null;
  for (const cot of cots) {
    const suyos = toques.filter((t) => t.cotizacionId === cot.id && t.estado !== "enviando");
    const dto: SeguimientoCotDto = {
      toques: suyos.map((t) => ({
        toque: t.toque,
        estado: t.estado === "enviando" ? "enviado" : t.estado,
        detalle: t.detalle,
        en: t.createdAt.toISOString(),
      })),
      siguiente: null,
      motivo: null,
    };
    if (cot.estado === "enviada" && cot.enviadaEn) {
      if (!config.seguimiento.activo) dto.motivo = "El seguimiento está apagado (Ajustes → Cotizaciones)";
      else if (cot.id !== masReciente) dto.motivo = "Solo la cotización más reciente lleva seguimiento";
      else {
        dto.motivo = await motivoSinSeguimiento(organizationId, { cot, ...conv }, ahora);
        if (!dto.motivo) {
          const s = siguienteToque({
            ahora,
            enviadaEn: cot.enviadaEn,
            ultimoDelCliente: conv.lastInboundAt,
            hechos: suyos.map((t) => ({ toque: t.toque, en: t.createdAt })),
            config: config.seguimiento,
          });
          dto.siguiente = s ? { toque: s.toque, fecha: s.fecha.toISOString() } : null;
        }
      }
    }
    if (dto.toques.length > 0 || dto.siguiente || cot.estado === "enviada") out[cot.id] = dto;
  }
  return out;
}

/**
 * Para el seguimiento automático general (3/7/30 días): ¿esta conversación
 * tiene una cotización que lleva su propio seguimiento ahora mismo? Así no le
 * llegan dos recordatorios seguidos. Nunca lanza.
 */
export async function cotizacionConSeguimiento(
  organizationId: string,
  conversationId: string,
  ahora = new Date()
): Promise<string | null> {
  if (!cotizacionesEnabled()) return null;
  try {
    await asegurarTablas();
    const config = await leerConfig(organizationId);
    if (!config.seguimiento.activo) return null;
    const [f] = await getDb()
      .select({
        cot: cotizacion,
        lastInboundAt: schema.conversation.lastInboundAt,
        isTest: schema.conversation.isTest,
        channel: schema.conversation.channel,
        contactId: schema.conversation.contactId,
      })
      .from(cotizacion)
      .innerJoin(schema.conversation, eq(schema.conversation.id, cotizacion.conversationId))
      .where(
        and(
          eq(cotizacion.organizationId, organizationId),
          eq(cotizacion.conversationId, conversationId),
          eq(cotizacion.estado, "enviada"),
          eq(cotizacion.seguimientoPausado, false)
        )
      )
      .orderBy(desc(cotizacion.enviadaEn))
      .limit(1);
    if (!f?.cot.enviadaEn) return null;
    if (await motivoSinSeguimiento(organizationId, f, ahora)) return null;
    // Mientras le quede un recordatorio por salir (o salió hace menos de 2 días).
    const toques = await toquesDe(organizationId, [f.cot.id]);
    const hechos = toques.map((t) => ({ toque: t.toque, en: t.createdAt }));
    const s = siguienteToque({
      ahora,
      enviadaEn: f.cot.enviadaEn,
      ultimoDelCliente: f.lastInboundAt,
      hechos,
      config: config.seguimiento,
    });
    const reciente = hechos.some((h) => ahora.getTime() - h.en.getTime() < 2 * DIA_MS);
    return s || reciente ? folioDe(f.cot.numero) : null;
  } catch (err) {
    console.warn("[cotizaciones] no se pudo revisar el seguimiento de la cotización:", err);
    return null;
  }
}
