import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  armarTexto,
  fechaYHora,
  notaDeRespuesta,
  primerNombre,
  type AccionCita,
} from "@/lib/recordatorios";
import { cancelBooking } from "@/server/agenda/service";
import { despachoActivo } from "@/server/brains/config";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { anotarRespuesta, apartarRespuesta, envioPorId, leerConfig } from "./store";

/**
 * Módulo de la agencia — lo que pasa cuando el cliente toca un botón del
 * recordatorio:
 *
 * - Confirmo: queda anotado en la cita y se le agradece.
 * - Cancelar: se cancela la cita (libera el horario y la reunión) y se le avisa.
 * - Reagendar: queda anotado; si el agente (Nea) atiende esa conversación, él
 *   sigue la plática (se le despacha el mensaje); si no, el CRM contesta con el
 *   texto del dueño y una persona lo ve en la bandeja.
 *
 * Nunca lanza: un fallo aquí no puede tumbar el webhook de Meta.
 */
export async function atenderBotonDeCita(input: {
  organizationId: string;
  waMessageId: string;
  conversationId: string;
  contactId: string;
  boton: { accion: AccionCita; envioId: string };
}): Promise<void> {
  const { organizationId, boton } = input;
  try {
    const envio = await envioPorId(organizationId, boton.envioId);
    if (!envio) return;

    // Un reintento de Meta con el mismo toque no se atiende dos veces.
    const libre = await apartarRespuesta({
      organizationId,
      waMessageId: input.waMessageId,
      envioId: envio.id,
      accion: boton.accion,
    });
    if (!libre) return;

    const db = getDb();
    const [booking] = await db
      .select()
      .from(schema.booking)
      .where(scoped(schema.booking.organizationId, organizationId, eq(schema.booking.id, envio.bookingId)))
      .limit(1);
    // El botón tiene que ser de una cita de ESTE contacto.
    if (!booking || booking.contactId !== input.contactId) return;

    const [contacto] = await db
      .select({ name: schema.contact.name })
      .from(schema.contact)
      .where(eq(schema.contact.id, input.contactId))
      .limit(1);
    const [ajustes] = await db
      .select({ timezone: schema.calendarSettings.timezone })
      .from(schema.calendarSettings)
      .where(eq(schema.calendarSettings.organizationId, organizationId))
      .limit(1);
    const zona = ajustes?.timezone ?? "America/Mexico_City";
    const config = await leerConfig(organizationId);
    const valores = {
      nombre: primerNombre(contacto?.name),
      ...fechaYHora(booking.scheduledAt, zona),
      enlace: booking.meetingLink,
    };
    const contestar = (texto: string) =>
      sendText({ organizationId, conversationId: input.conversationId, text: armarTexto(texto, valores) });

    if (booking.status !== "agendada") {
      if (boton.accion !== "reagendar") {
        await contestar(
          booking.status === "cancelada"
            ? "Esa cita ya estaba cancelada. Si quieres agendar otra, escríbenos por aquí."
            : "Esa cita ya no está activa. Si quieres agendar otra, escríbenos por aquí."
        );
        return;
      }
    }

    // La nota en la cita (una sola por respuesta: tocar dos veces lo mismo no la repite).
    if (envio.respuesta !== boton.accion) {
      const ahora = fechaYHora(new Date(), zona);
      const nota = notaDeRespuesta(boton.accion, `${ahora.fecha}, ${ahora.hora}`);
      await db
        .update(schema.booking)
        .set({ notes: booking.notes ? `${booking.notes}\n${nota}` : nota, updatedAt: new Date() })
        .where(eq(schema.booking.id, booking.id));
      await anotarRespuesta(envio.id, boton.accion);
      publish(organizationId, { type: "booking.updated", data: { bookingId: booking.id } });
    }

    if (boton.accion === "confirmo") {
      await contestar(config.textoConfirmo);
    } else if (boton.accion === "cancelo") {
      await cancelBooking({ organizationId, bookingId: booking.id });
      await contestar(config.textoCancelo);
    } else if (!(await cerebroAtiende(organizationId, input.conversationId))) {
      await contestar(config.textoReagendar);
    }
  } catch (err) {
    console.warn(
      `[recordatorios] no se atendió el botón ${boton.accion} (${input.waMessageId}):`,
      err instanceof Error ? err.message : err
    );
  }
}

/** Las mismas condiciones del despacho: si se cumplen, el agente recibe «Reagendar» y contesta él. */
async function cerebroAtiende(organizationId: string, conversationId: string): Promise<boolean> {
  if (!despachoActivo()) return false;
  const db = getDb();
  const [conv] = await db
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(and(eq(schema.conversation.id, conversationId), eq(schema.conversation.organizationId, organizationId)))
    .limit(1);
  if (!conv || !conv.aiEnabled || conv.handoffAt || conv.isTest) return false;
  const [perfil] = await db
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return Boolean(perfil?.enabled);
}
