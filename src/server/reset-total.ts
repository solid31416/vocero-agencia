import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { vaciarFicha } from "@/server/bot/ficha";
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";
import { olvidarNombreReal } from "@/server/nombre-real";

/**
 * Módulo de la agencia — `/reset` que borra TODO (bandera `RESET_TOTAL`).
 *
 * El `/reset` del raíz solo reactiva la IA y regresa el lead a la primera
 * etapa: el historial queda como auditoría. Para quien prueba su agente una y
 * otra vez desde su propio WhatsApp eso no alcanza: la ficha («Dr. Arroyo»),
 * las cotizaciones, el termómetro y los mensajes seguían ahí, y el agente
 * «recordaba» la prueba anterior. Con la bandera, el reset deja la
 * conversación como recién llegada.
 *
 * Solo lo dispara el comando `/reset` de la allowlist de pruebas del cerebro
 * (`TESTER_IDENTITIES` de Nea): nunca la conversación de un cliente. Apagado
 * por defecto (ADR-001).
 */
export function resetTotalEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.RESET_TOTAL);
}

/**
 * Tablas de los módulos de la agencia colgadas de la conversación. El orden
 * importa: los pedidos apuntan a las cotizaciones, y las sugerencias a los
 * traspasos. Se crean al primer uso de cada módulo, así que una puede no
 * existir todavía.
 */
export const TABLAS_DE_LA_CONVERSACION = [
  "agencia_biblioteca_envio",
  "agencia_termometro",
  "agencia_resumen_traspaso",
  "agencia_espera_aviso",
  "agencia_seguimiento_envio",
  "agencia_seguimiento_pausa",
  "agencia_aprende_sugerencia",
  "agencia_aprende_traspaso",
  "agencia_pedido",
  "agencia_cotizacion",
] as const;

/**
 * Borra todo lo de una conversación de pruebas y la ficha de su contacto. La
 * conversación y el lead se quedan (el reset los reactiva y los regresa al
 * inicio), y la ventana de 24 h también: el `/reset` mismo la abrió, y por
 * ella sale la confirmación. Cada paso es aparte: si uno falla, los demás
 * siguen y se reporta cuál.
 */
export async function borrarTodoDeLaConversacion(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
}): Promise<{ fallos: string[] }> {
  const { organizationId, conversationId, contactId } = input;
  const db = getDb();
  const fallos: string[] = [];
  const paso = async (nombre: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      fallos.push(nombre);
      console.warn(`[reset-total] ${nombre} falló: ${err}`);
    }
  };

  for (const tabla of TABLAS_DE_LA_CONVERSACION) {
    await paso(tabla, async () => {
      const existe = await db.execute(sql`SELECT to_regclass(${tabla}) AS t`);
      const fila = (existe as unknown as { rows?: { t: string | null }[] }).rows?.[0] ?? (existe as unknown as { t: string | null }[])[0];
      if (!fila?.t) return;
      await db.execute(
        sql`DELETE FROM ${sql.identifier(tabla)} WHERE organization_id = ${organizationId} AND conversation_id = ${conversationId}`
      );
    });
  }

  await paso("notas internas", () =>
    db
      .delete(schema.conversationNote)
      .where(
        scoped(
          schema.conversationNote.organizationId,
          organizationId,
          eq(schema.conversationNote.conversationId, conversationId)
        )
      )
  );
  await paso("horarios ofrecidos", () =>
    db
      .delete(schema.offeredSlot)
      .where(
        scoped(schema.offeredSlot.organizationId, organizationId, eq(schema.offeredSlot.conversationId, conversationId))
      )
  );
  await paso("mensajes", () =>
    db
      .delete(schema.message)
      .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversationId)))
  );
  await paso("citas", () =>
    db
      .delete(schema.booking)
      .where(scoped(schema.booking.organizationId, organizationId, eq(schema.booking.contactId, contactId)))
  );
  await paso("historial de etapas", () =>
    db
      .delete(schema.leadStageEvent)
      .where(
        scoped(schema.leadStageEvent.organizationId, organizationId, eq(schema.leadStageEvent.contactId, contactId))
      )
  );
  // La ficha por su puerta única (`vaciarFicha`); las notas del contacto aparte.
  await paso("ficha", () => vaciarFicha(db, organizationId, contactId));
  // El nombre que dio el cliente se olvida: vuelve el de su perfil de WhatsApp.
  await paso("nombre real", () => olvidarNombreReal(organizationId, contactId));
  await paso("notas del contacto", () =>
    db
      .update(schema.contact)
      .set({ notes: null, updatedAt: new Date() })
      .where(and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.id, contactId)))
  );
  return { fallos };
}
