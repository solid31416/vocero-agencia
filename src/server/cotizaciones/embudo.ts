import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";

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
