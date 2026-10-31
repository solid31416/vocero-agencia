import { and, desc, eq, gt, isNotNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  armarTexto,
  avisosVencidos,
  BOTONES_CITA,
  fechaYHora,
  idBotonCita,
  textoConBotones,
  primerNombre,
  variablesPlantilla,
  type ConfigRecordatorios,
} from "@/lib/recordatorios";
import { sendBotones, sendText, SendError } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import { recordatoriosEnabled } from "./flag";
import { apartarEnvio, cerrarEnvio, configsActivas } from "./store";

/**
 * Módulo de la agencia — el revisor de recordatorios. Cada minuto, en el mismo
 * proceso (como el despacho al cerebro: sin colas externas), busca las citas
 * con un aviso vencido y lo manda por la conversación del cliente.
 *
 * - Ventana de 24 h abierta → el texto del dueño.
 * - Cerrada → la plantilla aprobada que eligió; sin plantilla, se omite y
 *   queda anotado por qué.
 * - Nunca citas de prueba (Laboratorio), bloqueos ni canceladas.
 * - Un fallo aquí jamás tumba nada: se anota en la bitácora del aviso.
 */

const INTERVALO_MS = 60_000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __voceroRecordatorios?: Estado };
function estado(): Estado {
  g.__voceroRecordatorios ??= { timer: null, corriendo: false };
  return g.__voceroRecordatorios;
}

export function iniciarRecordatorios(): void {
  if (!recordatoriosEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaRecordatorios(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[recordatorios] revisor encendido (cada minuto)");
}

/** Una pasada. Exportada para las pruebas y para correrla a mano. */
export async function tandaRecordatorios(ahora = new Date()): Promise<number> {
  const e = estado();
  if (e.corriendo) return 0;
  e.corriendo = true;
  let enviados = 0;
  try {
    for (const { organizationId, config } of await configsActivas()) {
      enviados += await revisarOrganizacion(organizationId, config, ahora).catch((err) => {
        console.error(`[recordatorios] ${organizationId}:`, err);
        return 0;
      });
    }
  } catch (err) {
    console.error("[recordatorios] la tanda falló:", err);
  } finally {
    e.corriendo = false;
  }
  return enviados;
}

async function revisarOrganizacion(
  organizationId: string,
  config: ConfigRecordatorios,
  ahora: Date
): Promise<number> {
  const db = getDb();
  const mayor = Math.max(...config.avisos);
  const hasta = new Date(ahora.getTime() + mayor * 60_000);

  const citas = await db
    .select({ booking: schema.booking, contacto: schema.contact.name })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.kind, "session"),
        eq(schema.booking.status, "agendada"),
        eq(schema.booking.isTest, false),
        isNotNull(schema.booking.contactId),
        gt(schema.booking.scheduledAt, ahora),
        lte(schema.booking.scheduledAt, hasta)
      )
    );
  if (!citas.length) return 0;

  const [ajustes] = await db
    .select({ timezone: schema.calendarSettings.timezone })
    .from(schema.calendarSettings)
    .where(scoped(schema.calendarSettings.organizationId, organizationId))
    .limit(1);
  const zona = ajustes?.timezone ?? "America/Mexico_City";

  let enviados = 0;
  for (const { booking, contacto } of citas) {
    for (const minutos of avisosVencidos(ahora, booking.scheduledAt, config.avisos)) {
      const id = await apartarEnvio({
        organizationId,
        bookingId: booking.id,
        citaEn: booking.scheduledAt,
        minutos,
        contacto: contacto ?? "",
      });
      if (!id) continue; // ya salió (o lo está mandando otra pasada)
      const r = await mandar(organizationId, config, booking, contacto, zona, id);
      await cerrarEnvio(id, r.estado, r.detalle);
      if (r.estado === "enviado") enviados += 1;
    }
  }
  return enviados;
}

async function mandar(
  organizationId: string,
  config: ConfigRecordatorios,
  booking: typeof schema.booking.$inferSelect,
  contacto: string | null,
  zona: string,
  envioId: string
): Promise<{ estado: "enviado" | "omitido" | "fallido"; detalle: string | null }> {
  const conversationId = await conversacionDe(organizationId, booking);
  if (!conversationId) {
    return { estado: "omitido", detalle: "El cliente no tiene conversación de WhatsApp" };
  }
  const valores = {
    nombre: primerNombre(contacto),
    ...fechaYHora(booking.scheduledAt, zona),
    enlace: booking.meetingLink,
  };

  const texto = armarTexto(config.texto, valores);

  // Con botones: Confirmo / Reagendar / Cancelar. Si el canal o Meta no los
  // aceptan, sale el mismo texto sin botones; con la ventana cerrada, la plantilla.
  let ventanaCerrada = false;
  if (config.botones) {
    try {
      await sendBotones({
        organizationId,
        conversationId,
        cuerpo: texto,
        botones: BOTONES_CITA.map((b) => ({ id: idBotonCita(b.accion, envioId), titulo: b.titulo })),
        textoEnHilo: textoConBotones(texto),
      });
      return { estado: "enviado", detalle: "Con botones (ventana abierta)" };
    } catch (err) {
      ventanaCerrada = err instanceof SendError && err.code === "window_closed";
      if (!ventanaCerrada) {
        console.warn("[recordatorios] sin botones:", err instanceof Error ? err.message : err);
      }
    }
  }

  if (!ventanaCerrada) {
    try {
      await sendText({ organizationId, conversationId, text: texto });
      return { estado: "enviado", detalle: "Texto (ventana abierta)" };
    } catch (err) {
      if (!(err instanceof SendError && err.code === "window_closed")) {
        return { estado: "fallido", detalle: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  if (!config.plantillaId) {
    return {
      estado: "omitido",
      detalle: "Ventana de 24 h cerrada y sin plantilla elegida",
    };
  }
  try {
    await sendTemplate({
      organizationId,
      conversationId,
      templateId: config.plantillaId,
      variables: variablesPlantilla(valores),
    });
    return { estado: "enviado", detalle: "Plantilla (ventana cerrada)" };
  } catch (err) {
    return { estado: "fallido", detalle: err instanceof Error ? err.message : String(err) };
  }
}

/** La conversación de la cita; si no quedó ligada, la más reciente del contacto. */
async function conversacionDe(
  organizationId: string,
  booking: typeof schema.booking.$inferSelect
): Promise<string | null> {
  const db = getDb();
  if (booking.conversationId) {
    const [c] = await db
      .select({ id: schema.conversation.id, isTest: schema.conversation.isTest })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, booking.conversationId)))
      .limit(1);
    if (c && !c.isTest) return c.id;
  }
  if (!booking.contactId) return null;
  const [c] = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(
          eq(schema.conversation.contactId, booking.contactId),
          eq(schema.conversation.channel, "whatsapp"),
          eq(schema.conversation.isTest, false)
        )
      )
    )
    .orderBy(desc(schema.conversation.lastMessageAt))
    .limit(1);
  return c?.id ?? null;
}
