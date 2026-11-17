import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { prometeTraspaso } from "@/lib/promesa-traspaso";
import { publish } from "@/server/events/bus";
import { dispararResumen } from "@/server/resumen-traspaso/generar";
import { registrarTraspaso } from "@/server/aprende-traspasos/analizar";

/**
 * Módulo de la agencia — si el agente le prometió al cliente una persona y no
 * pidió el traspaso, el CRM lo hace: pausa la IA, deja la conversación para
 * el equipo y le avisa al dueño (el mismo camino que `POST /api/bot/handoff`).
 *
 * Espera unos segundos antes de revisar: lo normal es que el agente mande su
 * mensaje y en seguida pida el traspaso, y así no se le corta una respuesta
 * en dos partes. Nunca truena.
 */
const ESPERA_MS = 20_000;

export function vigilarPromesaDeTraspaso(organizationId: string, conversationId: string, texto: string): void {
  if (!prometeTraspaso(texto)) return;
  const t = setTimeout(() => {
    void cumplirPromesa(organizationId, conversationId).catch((err) => {
      console.warn("[traspaso] no se pudo revisar la promesa de traspaso:", err);
    });
  }, ESPERA_MS);
  t.unref?.();
}

/** Hace el traspaso si sigue pendiente. Devuelve si lo hizo (exportada para probarla). */
export async function cumplirPromesa(organizationId: string, conversationId: string): Promise<boolean> {
  const db = getDb();
  const [conv] = await db
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(and(eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, conversationId)))
    .limit(1);
  // Ya la tomó una persona (o el agente sí pidió el traspaso), o es del Laboratorio.
  if (!conv || conv.isTest || !conv.aiEnabled || conv.handoffAt) return false;

  const motivo = "modelo";
  const filas = await db
    .update(schema.conversation)
    .set({ aiEnabled: false, handoffAt: new Date(), handoffReason: motivo, updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId),
        isNull(schema.conversation.handoffAt)
      )
    )
    .returning({ id: schema.conversation.id });
  if (filas.length === 0) return false;

  console.info(`[traspaso] el agente prometió una persona sin pedir el traspaso; lo hizo el CRM (${conversationId})`);
  publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
  dispararResumen(organizationId, conversationId, motivo, { avisar: true });
  registrarTraspaso(organizationId, conversationId, motivo);
  return true;
}
