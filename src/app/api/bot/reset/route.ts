import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { olvidarEnvios } from "@/server/biblioteca/store";
import { borrarTodoDeLaConversacion, resetTotalEnabled } from "@/server/reset-total";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
});

/**
 * Reinicio de UNA conversación para la línea de pruebas del operador: IA
 * reactivada (sale del handoff) y lead de vuelta a la primera etapa. El
 * historial del inbox NO se borra: es auditoría. Lo invoca el cerebro externo
 * cuando un número de su allowlist manda `/reset`.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  // Módulo de la agencia: con RESET_TOTAL la prueba empieza de cero (ficha,
  // mensajes, cotizaciones, termómetro…), antes de regresar la etapa.
  if (resetTotalEnabled()) {
    const { fallos } = await borrarTodoDeLaConversacion({
      organizationId,
      conversationId: conv.id,
      contactId: conv.contactId,
    });
    if (fallos.length > 0) console.warn(`[bot/reset] reset total incompleto: ${fallos.join(", ")}`);
  }

  await db
    .update(schema.conversation)
    .set({
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conv.id));

  // Etapa al inicio del funnel (best-effort: sin etapas no revienta el reset).
  try {
    const stages = await db
      .select()
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, organizationId));
    const first = [...stages].sort((a, b) => a.position - b.position)[0];
    const leadRows = await db
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, conv.contactId)
        )
      )
      .limit(1);
    if (first && leadRows[0]) {
      // Por la puerta única: devolver la conversación de pruebas al inicio
      // también es un movimiento, y la bitácora tiene que poder explicar por
      // qué un lead retrocedió de etapa.
      await moveLeadToStage({
        organizationId,
        leadId: leadRows[0].id,
        toStageId: first.id,
        source: "sistema",
      });
    }
  } catch (err) {
    console.warn(`[bot/reset] reinicio de etapa falló: ${err}`);
  }

  // Módulo de la agencia (Biblioteca): la conversación reiniciada empieza sin
  // archivos «ya enviados» (best-effort, como la etapa).
  if (bibliotecaEnabled() && !resetTotalEnabled()) {
    await olvidarEnvios(organizationId, conv.id).catch((err) =>
      console.warn(`[bot/reset] olvidar envíos de la biblioteca falló: ${err}`)
    );
  }

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conv.id }, ...(resetTotalEnabled() ? { reiniciada: true } : {}) },
  });
  return Response.json({ ok: true });
}
