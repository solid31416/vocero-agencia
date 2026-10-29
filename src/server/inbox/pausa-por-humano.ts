import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { getConversation, serializeConversation } from "@/server/inbox/queries";
import { pausaPorHumanoEnabled } from "@/server/inbox/pausa-por-humano-flag";

/**
 * Módulo de la agencia (Treviño AI) — Pausa la IA cuando responde una persona.
 *
 * Si alguien del equipo escribe desde la bandeja (texto, adjunto, plantilla o
 * reenvío), el agente de ESA conversación se pausa: el despacho ya respeta
 * `conversation.ai_enabled` (`encolar.ts`), así que el cerebro deja de
 * contestarle encima a la persona. Se reactiva desde la bandeja, como
 * siempre («IA en esta conversación»).
 *
 * Solo lo llaman las rutas de la bandeja (sesión de una persona), nunca
 * `/api/bot/messages`: el cerebro envía por el mismo `sendText` y no debe
 * pausarse a sí mismo.
 *
 * No toca el esquema: es el mismo `ai_enabled` que el interruptor manual, así
 * que volver a la imagen raíz no deja nada a medias. Nunca rompe el envío: el
 * mensaje ya salió cuando se llama, y un fallo aquí solo se registra.
 *
 * @returns `true` si la pausó ahora; `false` si la bandera está apagada, la IA
 * ya estaba en pausa o algo falló.
 */
export async function pausarIaPorHumano(
  organizationId: string,
  conversationId: string
): Promise<boolean> {
  if (!pausaPorHumanoEnabled()) return false;
  try {
    const db = getDb();
    const pausadas = await db
      .update(schema.conversation)
      .set({ aiEnabled: false, updatedAt: new Date() })
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          and(
            eq(schema.conversation.id, conversationId),
            eq(schema.conversation.aiEnabled, true)
          )
        )
      )
      .returning({ id: schema.conversation.id });
    if (pausadas.length === 0) return false;

    // Mismo aviso que el interruptor manual (PATCH /api/conversations/[id]):
    // la bandeja muestra la IA en pausa sin recargar.
    const row = await getConversation(organizationId, conversationId);
    if (row) {
      publish(organizationId, {
        type: "conversation.updated",
        data: {
          conversation: serializeConversation(
            row.conversation,
            row.contact,
            null,
            null,
            row.anuncio
          ),
        },
      });
    }
    return true;
  } catch (err) {
    console.error(
      "[pausa-por-humano] no pude pausar la IA:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
