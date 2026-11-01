import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { chatJson } from "@/lib/ai";
import {
  CONTEXTO_PREVIO,
  MAX_MENSAJES,
  armarPrompt,
  decidir,
  limpiarSugerencias,
  quienHabla,
  respuestaIaSchema,
  textoDeMensaje,
  type MensajeParaAprender,
} from "@/lib/aprende-traspasos";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { aprendeEnabled } from "./flag";
import {
  abrirTraspaso,
  aprendeTraspaso,
  cerrarTraspaso,
  guardarSugerencias,
  leerConfig,
  preguntasPendientes,
  traspasosAbiertos,
} from "./store";

/**
 * Módulo de la agencia — Nea aprende de sus traspasos.
 *
 * 1. Cuando el agente pasa una conversación, se anota (`registrarTraspaso`).
 * 2. Un revisor cada 10 minutos mira los traspasos abiertos: cuando una
 *    persona ya contestó y la plática se calmó (o la IA se reactivó), la IA
 *    lee lo que dijo la persona y propone P/R para el conocimiento.
 * 3. El dueño las aprueba o descarta en la pantalla Agente.
 *
 * Nunca lanza hacia quien lo llama, y nunca agrega nada al conocimiento solo.
 * Usa el modelo «juez» de Ajustes → IA (el barato, si hay uno).
 */

const INTERVALO_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 45_000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __aprendeTraspasos?: Estado };
function estado(): Estado {
  g.__aprendeTraspasos ??= { timer: null, corriendo: false };
  return g.__aprendeTraspasos;
}

/** Anota el traspaso sin hacer esperar a nadie. Para el gancho de `/api/bot/handoff`. */
export function registrarTraspaso(organizationId: string, conversationId: string, motivo: string): void {
  if (!aprendeEnabled()) return;
  void (async () => {
    const config = await leerConfig(organizationId);
    if (!config.activo) return;
    await abrirTraspaso(organizationId, conversationId, motivo);
  })().catch((err) => console.warn(`[aprende] no se anotó el traspaso de ${conversationId}:`, err));
}

export function iniciarAprende(): void {
  if (!aprendeEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaAprende(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[aprende] revisor de traspasos encendido (cada 10 minutos)");
}

export type ResultadoTanda = { analizados: number; sugerencias: number; esperando: number; errores: number };

/** Una pasada. `forzar` = el botón «Buscar ahora» (no espera a que se calme la plática). */
export async function tandaAprende(
  opciones: { organizationId?: string; forzar?: boolean; ahora?: Date } = {}
): Promise<ResultadoTanda> {
  const r: ResultadoTanda = { analizados: 0, sugerencias: 0, esperando: 0, errores: 0 };
  const e = estado();
  if (e.corriendo) return r;
  e.corriendo = true;
  try {
    const ahora = opciones.ahora ?? new Date();
    const activos = new Map<string, boolean>();
    for (const t of await traspasosAbiertos(opciones.organizationId)) {
      if (!activos.has(t.organizationId)) {
        activos.set(t.organizationId, (await leerConfig(t.organizationId)).activo);
      }
      if (!activos.get(t.organizationId)) continue;
      try {
        const salida = await revisarTraspaso(t, ahora, opciones.forzar === true);
        if (salida === "esperar") r.esperando++;
        else if (typeof salida === "number") {
          r.analizados++;
          r.sugerencias += salida;
        }
      } catch (err) {
        r.errores++;
        console.warn(`[aprende] el traspaso ${t.id} falló:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[aprende] la tanda falló:", err);
  } finally {
    e.corriendo = false;
  }
  return r;
}

type Traspaso = typeof aprendeTraspaso.$inferSelect;

/** Devuelve cuántas sugerencias dejó, "esperar", o "cerrado" (vencido / sin IA). */
async function revisarTraspaso(t: Traspaso, ahora: Date, forzar: boolean): Promise<number | "esperar" | "cerrado"> {
  const db = getDb();
  const [conv] = await db
    .select({ aiEnabled: schema.conversation.aiEnabled, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, t.organizationId, eq(schema.conversation.id, t.conversationId)))
    .limit(1);
  if (!conv || conv.isTest) {
    await cerrarTraspaso(t.id, "vencido", conv ? "conversación de prueba" : "la conversación ya no existe");
    return "cerrado";
  }

  // Lo que pasó desde el traspaso (hasta el tope), para saber si una persona contestó.
  const despues = await db
    .select({
      direction: schema.message.direction,
      origin: schema.message.origin,
      aiGenerated: schema.message.aiGenerated,
      type: schema.message.type,
      text: schema.message.text,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, t.organizationId),
        eq(schema.message.conversationId, t.conversationId),
        gte(schema.message.createdAt, t.desde)
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(MAX_MENSAJES);
  const personaRespondio = despues.some((m) => quienHabla(m) === "persona");
  const ultimoMensajeEn = despues.length ? despues[despues.length - 1]!.createdAt : null;

  const decision = decidir({
    desde: t.desde,
    ahora,
    iaReactivada: conv.aiEnabled,
    personaRespondio,
    ultimoMensajeEn,
    forzar,
  });
  if (decision === "vencido") {
    await cerrarTraspaso(t.id, "vencido", "nadie contestó en 7 días");
    return "cerrado";
  }
  if (decision === "esperar") return "esperar";

  // Un poco de lo de antes, para entender de qué se hablaba.
  const antes = await db
    .select({
      direction: schema.message.direction,
      origin: schema.message.origin,
      aiGenerated: schema.message.aiGenerated,
      type: schema.message.type,
      text: schema.message.text,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, t.organizationId),
        eq(schema.message.conversationId, t.conversationId),
        lt(schema.message.createdAt, t.desde)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(CONTEXTO_PREVIO);

  const mensajes: MensajeParaAprender[] = [];
  for (const [lista, despuesDelTraspaso] of [
    [antes.reverse(), false],
    [despues, true],
  ] as const) {
    for (const m of lista) {
      const quien = quienHabla(m);
      if (quien) mensajes.push({ quien, texto: textoDeMensaje(m.type, m.text), despuesDelTraspaso });
    }
  }

  const [kb, org, pendientes] = await Promise.all([
    db
      .select({ kind: schema.kbEntry.kind, q: schema.kbEntry.question, a: schema.kbEntry.answer, c: schema.kbEntry.content })
      .from(schema.kbEntry)
      .where(scoped(schema.kbEntry.organizationId, t.organizationId)),
    db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, t.organizationId))
      .limit(1),
    preguntasPendientes(t.organizationId),
  ]);
  const conocimiento = kb
    .filter((k) => k.kind === "qa" && k.q && k.a)
    .map((k) => ({ pregunta: k.q!, respuesta: k.a! }));
  const bloques = kb.filter((k) => k.kind === "block" && k.c).map((k) => k.c!);

  const { system, user } = armarPrompt({
    nombreNegocio: org[0]?.name ?? "",
    conocimiento,
    bloques,
    mensajes,
  });
  const r = await chatJson(
    respuestaIaSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { organizationId: t.organizationId, judge: true, timeoutMs: TIMEOUT_MS }
  );
  if (!r.ok) {
    if (r.error === "not_configured") return "esperar"; // sin llave todavía: se reintenta después
    console.warn(`[aprende] la IA no contestó bien para ${t.conversationId}: ${r.error} — ${r.detail}`);
    await cerrarTraspaso(t.id, "error", `${r.error}`.slice(0, 200));
    return "cerrado";
  }

  const sugerencias = limpiarSugerencias(respuestaIaSchema.parse(r.data).sugerencias, [
    ...conocimiento.map((c) => c.pregunta),
    ...pendientes,
  ]);
  await guardarSugerencias(t, sugerencias);
  await cerrarTraspaso(t.id, "analizado", `${sugerencias.length} sugerencia(s)`);
  console.info(`[aprende] ${t.conversationId}: ${sugerencias.length} sugerencia(s)`);
  return sugerencias.length;
}
