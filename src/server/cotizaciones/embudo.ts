import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { etapaDeCotizacion } from "@/lib/cotizaciones";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";

/**
 * Módulo de la agencia — que el embudo se entere de la cotización: el trato
 * del cliente toma el total de la cotización como su monto. Al ENVIARLA,
 * solo si nadie le había puesto monto; al ACEPTARLA, siempre (ese es el
 * valor de la venta). Así el Pipeline y Resultados («Dinero ganado», «Dinero
 * en tratos abiertos») cuadran con las cotizaciones. Nunca truena.
 */
export async function montoAlTrato(input: {
  organizationId: string;
  contactId: string | null;
  conversationId: string | null;
  total: number;
  moneda: string;
  soloSiVacio: boolean;
}): Promise<void> {
  if (!input.contactId || !(input.total > 0)) return;
  try {
    const filas = await getDb()
      .update(schema.lead)
      .set({ amountCents: Math.round(input.total * 100), currency: input.moneda, updatedAt: new Date() })
      .where(
        and(
          eq(schema.lead.organizationId, input.organizationId),
          eq(schema.lead.contactId, input.contactId),
          input.soloSiVacio ? isNull(schema.lead.amountCents) : undefined
        )
      )
      .returning({ id: schema.lead.id });
    if (filas.length > 0 && input.conversationId) {
      publish(input.organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: input.conversationId } },
      });
    }
  } catch (err) {
    console.warn("[cotizaciones] no se pudo poner el monto al trato:", err);
  }
}

/**
 * Al salir la cotización, el trato pasa a la etapa de «Cotización enviada»
 * (si el negocio tiene una). Solo hacia adelante y desde una etapa abierta:
 * si ya iba más adelante, ganado o perdido, se queda donde está. Esa etapa
 * la pone el CRM, no la IA (ver `src/server/bot/stage.ts`). Nunca truena.
 */
export async function moverACotizacion(input: {
  organizationId: string;
  contactId: string | null;
  conversationId: string | null;
  actorUserId: string | null;
}): Promise<string | null> {
  if (!input.contactId) return null;
  try {
    const db = getDb();
    const etapas = await db
      .select({
        id: schema.pipelineStage.id,
        name: schema.pipelineStage.name,
        kind: schema.pipelineStage.kind,
        position: schema.pipelineStage.position,
      })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, input.organizationId))
      .orderBy(asc(schema.pipelineStage.position));
    const destino = etapaDeCotizacion(etapas);
    if (!destino) return null;
    const [lead] = await db
      .select({ id: schema.lead.id, stageId: schema.lead.stageId })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, input.organizationId, eq(schema.lead.contactId, input.contactId)))
      .limit(1);
    if (!lead) return null;
    const actual = etapas.find((e) => e.id === lead.stageId);
    if (actual && (actual.kind !== "open" || actual.position >= destino.position)) return null;
    const r = await moveLeadToStage({
      organizationId: input.organizationId,
      leadId: lead.id,
      toStageId: destino.id,
      actorUserId: input.actorUserId,
      source: input.actorUserId ? "dueno" : "sistema",
    });
    if (r.ok && r.changed && input.conversationId) {
      publish(input.organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: input.conversationId } },
      });
    }
    return r.ok && r.changed ? destino.name : null;
  } catch (err) {
    console.warn("[cotizaciones] no se pudo mover el trato a la etapa de cotización:", err);
    return null;
  }
}
