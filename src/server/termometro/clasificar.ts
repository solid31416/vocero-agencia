import { and, desc, eq } from "drizzle-orm";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import {
  MAX_MENSAJES,
  armarPrompt,
  debeClasificar,
  limpiarClasificacion,
  respuestaIaSchema,
  textoDeMensaje,
  type ConfigTermometro,
  type MensajeParaClasificar,
} from "@/lib/termometro";
import { publish } from "@/server/events/bus";
import { termometroEnabled } from "./flag";
import { candidatas, guardarClasificacion, leerConfig, organizacionesActivas } from "./store";

/**
 * Módulo de la agencia — el termómetro del cliente.
 *
 * Un revisor cada 3 minutos busca conversaciones con mensajes nuevos que ya
 * se calmaron (2 min sin mensajes) y le pide a la IA (modelo «juez», el
 * barato) temperatura y etiquetas. Nunca lanza. Unas cuantas por pasada,
 * para no gastar de golpe.
 */

const INTERVALO_MS = 3 * 60 * 1000;
const POR_PASADA = 15;
const TIMEOUT_MS = 30_000;

/** Si la IA falla con una conversación, no se reintenta hasta pasado este tiempo. */
const ESPERA_TRAS_ERROR_MS = 30 * 60 * 1000;

type Estado = {
  timer: ReturnType<typeof setInterval> | null;
  corriendo: boolean;
  /** conversación → cuándo se puede reintentar. */
  enPausa: Map<string, number>;
};
const g = globalThis as unknown as { __termometro?: Estado };
function estado(): Estado {
  g.__termometro ??= { timer: null, corriendo: false, enPausa: new Map() };
  return g.__termometro;
}

export function iniciarTermometro(): void {
  if (!termometroEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaTermometro(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[termometro] revisor encendido (cada 3 minutos)");
}

export type ResultadoTanda = { clasificadas: number; errores: number; sinIa: boolean };

export async function tandaTermometro(
  opciones: { organizationId?: string; forzar?: boolean; ahora?: Date } = {}
): Promise<ResultadoTanda> {
  const r: ResultadoTanda = { clasificadas: 0, errores: 0, sinIa: false };
  const e = estado();
  if (e.corriendo) return r;
  e.corriendo = true;
  try {
    const ahora = opciones.ahora ?? new Date();
    const orgs = opciones.organizationId
      ? (await organizacionesActivas()).filter((o) => o === opciones.organizationId)
      : await organizacionesActivas();
    for (const org of orgs) {
      const config = await leerConfig(org);
      if (!config.activo) continue;
      for (const c of await candidatas(org, ahora, opciones.forzar === true, POR_PASADA)) {
        const toca = debeClasificar({
          ultimoMensajeEn: c.lastMessageAt,
          clasificadoEn: c.clasificadoEn,
          manual: c.manual === true,
          ahora,
          forzar: opciones.forzar,
        });
        if (!toca) continue;
        const pausa = e.enPausa.get(c.id);
        if (pausa && pausa > ahora.getTime() && !opciones.forzar) continue;
        const salida = await clasificar(org, c.id, config).catch((err) => {
          console.warn(`[termometro] ${c.id}:`, err instanceof Error ? err.message : err);
          return "error" as const;
        });
        if (salida === "ok") {
          r.clasificadas++;
          e.enPausa.delete(c.id);
        } else if (salida === "sin_ia") {
          r.sinIa = true;
          break;
        } else {
          r.errores++;
          e.enPausa.set(c.id, ahora.getTime() + ESPERA_TRAS_ERROR_MS);
        }
      }
    }
  } catch (err) {
    console.error("[termometro] la tanda falló:", err);
  } finally {
    e.corriendo = false;
  }
  return r;
}

async function clasificar(
  organizationId: string,
  conversationId: string,
  config: ConfigTermometro
): Promise<"ok" | "sin_ia" | "error"> {
  const db = getDb();
  const [recientes, org] = await Promise.all([
    db
      .select({
        direction: schema.message.direction,
        type: schema.message.type,
        text: schema.message.text,
      })
      .from(schema.message)
      .where(and(eq(schema.message.organizationId, organizationId), eq(schema.message.conversationId, conversationId)))
      .orderBy(desc(schema.message.createdAt))
      .limit(MAX_MENSAJES),
    db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1),
  ]);
  const mensajes: MensajeParaClasificar[] = recientes.reverse().map((m) => ({
    quien: m.direction === "in" ? "cliente" : "negocio",
    texto: textoDeMensaje(m.type, m.text),
  }));
  if (!mensajes.some((m) => m.quien === "cliente")) {
    // Nada del cliente que leer: se marca vista, sin temperatura, para no volver a ella.
    await guardarClasificacion(organizationId, conversationId, { temperatura: null, etiquetas: [], razon: "" }, { manual: false });
    return "ok";
  }

  const { system, user } = armarPrompt({ nombreNegocio: org[0]?.name ?? "", config, mensajes });
  const r = await chatJson(
    respuestaIaSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { organizationId, judge: true, timeoutMs: TIMEOUT_MS }
  );
  if (!r.ok) {
    if (r.error === "not_configured") return "sin_ia";
    console.warn(`[termometro] la IA no clasificó ${conversationId}: ${r.error} — ${r.detail}`);
    return "error";
  }
  const cl = limpiarClasificacion(r.data, config.etiquetas);
  await guardarClasificacion(organizationId, conversationId, cl, { manual: false });
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
  return "ok";
}
