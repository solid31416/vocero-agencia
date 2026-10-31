import { and, desc, eq } from "drizzle-orm";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import {
  MAX_MENSAJES,
  armarPrompt,
  resumenSchema,
  textoAviso,
  textoDeMensaje,
  type MensajeParaResumen,
} from "@/lib/resumen-traspaso";
import { avisarAlDueno } from "@/server/contador-mensajes/worker";
import { publish } from "@/server/events/bus";
import { resumenEnabled } from "./flag";
import { guardarResumen, leerConfig, leerResumen } from "./store";

/**
 * Módulo de la agencia — arma el resumen para quien atiende.
 *
 * Corre en segundo plano (nunca hace esperar al cerebro ni a la bandeja) y
 * nunca lanza. Si desde el último resumen no llegó ningún mensaje nuevo, no le
 * vuelve a pagar a la IA. Usa el modelo «juez» de Ajustes → IA (el barato, si
 * hay uno), con la misma llave que ya usa el CRM.
 */

const TIMEOUT_MS = 30_000;

/** Conversaciones con un resumen armándose ahora (para que la bandeja muestre «Armando…»). */
const enCurso = new Set<string>();

export function generando(conversationId: string): boolean {
  return enCurso.has(conversationId);
}

export type ResultadoResumen =
  | { ok: true; nuevo: boolean }
  | { ok: false; codigo: "apagado" | "no_existe" | "sin_ia" | "ia_fallo" | "ocupado"; detalle: string };

/** Lanza el resumen sin esperarlo. Para los ganchos del traspaso y de la pausa. */
export function dispararResumen(
  organizationId: string,
  conversationId: string,
  motivo: string,
  opciones: { avisar: boolean }
): void {
  if (!resumenEnabled()) return;
  void generarResumen(organizationId, conversationId, motivo, { ...opciones, forzar: false }).catch((err) =>
    console.warn(`[resumen] ${conversationId}:`, err instanceof Error ? err.message : err)
  );
}

export async function generarResumen(
  organizationId: string,
  conversationId: string,
  motivo: string,
  opciones: { avisar: boolean; forzar: boolean }
): Promise<ResultadoResumen> {
  const config = await leerConfig(organizationId);
  if (!config.activo) return { ok: false, codigo: "apagado", detalle: "El resumen está apagado en Ajustes → IA" };
  if (enCurso.has(conversationId)) return { ok: false, codigo: "ocupado", detalle: "Ya se está armando" };
  enCurso.add(conversationId);
  try {
    const db = getDb();
    const [fila] = await db
      .select({ conversation: schema.conversation, contact: schema.contact })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
      .limit(1);
    if (!fila) return { ok: false, codigo: "no_existe", detalle: "Conversación no encontrada" };

    const recientes = await db
      .select({
        id: schema.message.id,
        direction: schema.message.direction,
        origin: schema.message.origin,
        aiGenerated: schema.message.aiGenerated,
        type: schema.message.type,
        text: schema.message.text,
      })
      .from(schema.message)
      .where(
        and(eq(schema.message.organizationId, organizationId), eq(schema.message.conversationId, conversationId))
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(MAX_MENSAJES);
    const ultimo = recientes[0]?.id ?? null;

    const previo = await leerResumen(organizationId, conversationId);
    if (!opciones.forzar && previo && previo.hastaMensajeId === ultimo) {
      return { ok: true, nuevo: false };
    }

    const mensajes: MensajeParaResumen[] = recientes.reverse().map((m) => ({
      quien: m.direction === "in" ? "cliente" : m.aiGenerated || m.origin === "ai" ? "agente" : "persona",
      texto: textoDeMensaje(m.type, m.text),
    }));
    const { system, user } = armarPrompt({
      nombreContacto: fila.contact.name,
      ficha: fila.contact.ficha ?? null,
      motivo,
      mensajes,
    });
    const r = await chatJson(
      resumenSchema,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { organizationId, judge: true, timeoutMs: TIMEOUT_MS }
    );
    if (!r.ok) {
      console.warn(`[resumen] la IA no armó el resumen de ${conversationId}: ${r.error} — ${r.detail}`);
      return r.error === "not_configured"
        ? { ok: false, codigo: "sin_ia", detalle: "Configura la IA en Ajustes → IA" }
        : { ok: false, codigo: "ia_fallo", detalle: "La IA no contestó bien. Intenta de nuevo." };
    }

    // Con los campos ya limpios (lo que la IA mandó raro queda vacío).
    const resumen = resumenSchema.parse(r.data);
    await guardarResumen({ organizationId, conversationId, motivo, resumen, hastaMensajeId: ultimo });
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });

    if (opciones.avisar && config.avisarDueno && config.telefonoDueno) {
      const enlace = `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/inbox?conversation=${conversationId}`;
      const texto = textoAviso({ nombreContacto: fila.contact.name, resumen, motivo, enlace });
      const salida = await avisarAlDueno(organizationId, { telefonoDueno: config.telefonoDueno, plantillaId: null }, texto, "");
      console.info(`[resumen] aviso al dueño de ${conversationId}: ${salida}`);
    }
    return { ok: true, nuevo: true };
  } finally {
    enCurso.delete(conversationId);
  }
}
