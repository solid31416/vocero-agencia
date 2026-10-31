import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { normalizeMx } from "@/lib/meta/client";
import { claveAviso, hayQueAvisar, textoAviso, type ConfigContador } from "@/lib/contador-mensajes";
import { sendText, SendError } from "@/server/inbox/send";
import { countVariables, sendTemplate } from "@/server/whatsapp/templates";
import { contadorEnabled } from "./flag";
import { actualizarOficial } from "./oficial";
import { calcularMes, olvidarCache } from "./resumen";
import { anotarAviso } from "./store";

/**
 * Módulo de la agencia — el revisor del contador. Cada 15 minutos, en el mismo
 * proceso (sin colas externas, como el despacho al cerebro):
 *
 * 1. renueva el reporte oficial de costos de Meta (cada ~3 h, en caché);
 * 2. si el mes subió de nivel (cerca del límite → ya cobra → no entrega), le
 *    avisa al dueño por WhatsApp UNA vez por nivel y por mes. La franja del
 *    CRM no depende de esto: se calcula sola en cada pantalla.
 *
 * Un fallo aquí jamás tumba nada: se anota y se reintenta en la siguiente vuelta.
 */

const INTERVALO_MS = 15 * 60_000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __voceroContadorWorker?: Estado };
function estado(): Estado {
  g.__voceroContadorWorker ??= { timer: null, corriendo: false };
  return g.__voceroContadorWorker;
}

export function iniciarContador(): void {
  if (!contadorEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void vueltaContador(), INTERVALO_MS);
  e.timer.unref?.();
  // Una primera vuelta al arrancar, sin esperar 15 minutos.
  setTimeout(() => void vueltaContador(), 30_000).unref?.();
  console.log("[contador] revisor encendido (cada 15 minutos)");
}

export async function vueltaContador(ahora = new Date()): Promise<void> {
  const e = estado();
  if (e.corriendo) return;
  e.corriendo = true;
  try {
    const orgs = await getDb()
      .selectDistinct({ id: schema.metaCredentials.organizationId })
      .from(schema.metaCredentials)
      .where(eq(schema.metaCredentials.status, "connected"));
    for (const { id } of orgs) {
      await revisar(id, ahora).catch((err) => console.error(`[contador] ${id}:`, err));
    }
  } catch (err) {
    console.error("[contador] la vuelta falló:", err);
  } finally {
    e.corriendo = false;
  }
}

async function revisar(organizationId: string, ahora: Date): Promise<void> {
  await actualizarOficial(organizationId, ahora);
  const { resumen, mes, config } = await calcularMes(organizationId, ahora);
  if (!hayQueAvisar(resumen.estado, mes.mes, config.ultimoAviso)) return;
  const texto = textoAviso(resumen, config.alertaPct);
  if (!texto) return;
  const detalle = await avisarAlDueno(organizationId, config, texto);
  await anotarAviso(organizationId, claveAviso(mes.mes, resumen.estado), detalle);
  olvidarCache(organizationId);
  console.log(`[contador] ${organizationId}: aviso «${resumen.estado}» — ${detalle}`);
}

/** Le manda el aviso al dueño por WhatsApp. Devuelve qué pasó, en palabras, para la pantalla. */
export async function avisarAlDueno(
  organizationId: string,
  config: Pick<ConfigContador, "telefonoDueno" | "plantillaId">,
  texto: string,
  /** El resumen para quien atiende lo usa sin el ⚠️ del contador. */
  prefijo = "⚠️ "
): Promise<string> {
  if (!config.telefonoDueno) return "Solo en el CRM: no hay teléfono del dueño para avisarle por WhatsApp";
  const db = getDb();
  const [contacto] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        and(eq(schema.contact.channel, "whatsapp"), eq(schema.contact.waIdentity, normalizeMx(config.telefonoDueno)))
      )
    )
    .limit(1);
  const [conv] = contacto
    ? await db
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            and(
              eq(schema.conversation.contactId, contacto.id),
              eq(schema.conversation.channel, "whatsapp"),
              eq(schema.conversation.isTest, false)
            )
          )
        )
        .orderBy(desc(schema.conversation.lastMessageAt))
        .limit(1)
    : [];
  if (!conv) {
    return "No se mandó por WhatsApp: ese teléfono nunca le ha escrito a este número";
  }

  try {
    await sendText({ organizationId, conversationId: conv.id, text: `${prefijo}${texto}` });
    return "Enviado al dueño por WhatsApp";
  } catch (err) {
    if (!(err instanceof SendError && err.code === "window_closed")) {
      return `No se pudo mandar por WhatsApp: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (!config.plantillaId) {
    return "No se mandó por WhatsApp: el dueño no ha escrito en 24 h y no hay plantilla elegida";
  }
  try {
    const [t] = await db
      .select({ body: schema.template.body })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.id, config.plantillaId)))
      .limit(1);
    const variables = t && countVariables(t.body) > 0 ? [texto] : [];
    await sendTemplate({ organizationId, conversationId: conv.id, templateId: config.plantillaId, variables });
    return "Enviado al dueño con plantilla (ventana cerrada)";
  } catch (err) {
    return `No se pudo mandar la plantilla: ${err instanceof Error ? err.message : String(err)}`;
  }
}
