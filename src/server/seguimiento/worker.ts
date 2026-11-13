import { and, desc, eq, gt, gte, lte, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  armarVariables,
  describirDias,
  GRACIA_HORAS,
  pasoQueToca,
  siguientePaso,
  venceEn,
  type ConfigSeguimiento,
  type EstadoConversacionDto,
  type Paso,
} from "@/lib/seguimiento";
import { sendTemplate } from "@/server/whatsapp/templates";
import { seguimientoEnabled } from "./flag";
import {
  apartarEnvio,
  cerrarEnvio,
  configsActivas,
  diasYaSalidos,
  estaPausada,
  leerConfig,
  ultimosEnvios,
} from "./store";

/**
 * Módulo de la agencia — el revisor del seguimiento automático. Cada 5
 * minutos, en el mismo proceso (sin colas externas), busca a los clientes
 * que dejaron de contestar y les manda la plantilla del paso que toca.
 *
 * Nunca: conversaciones del Laboratorio, otros canales (las plantillas son
 * de WhatsApp), clientes en Ganado/Perdido o en una etapa excluida, ni a quien
 * alguien le detuvo el seguimiento. Un fallo aquí jamás tumba nada: queda en
 * la bitácora del envío.
 */

const INTERVALO_MS = 5 * 60_000;
const HORA_MS = 3_600_000;
const DIA_MS = 86_400_000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __voceroSeguimiento?: Estado };
function estado(): Estado {
  g.__voceroSeguimiento ??= { timer: null, corriendo: false };
  return g.__voceroSeguimiento;
}

export function iniciarSeguimiento(): void {
  if (!seguimientoEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaSeguimiento(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[seguimiento] revisor encendido (cada 5 minutos)");
}

/** Una pasada. Exportada para correrla a mano. */
export async function tandaSeguimiento(ahora = new Date()): Promise<number> {
  const e = estado();
  if (e.corriendo) return 0;
  e.corriendo = true;
  let enviados = 0;
  try {
    for (const { organizationId, config } of await configsActivas()) {
      enviados += await revisarOrganizacion(organizationId, config, ahora).catch((err) => {
        console.error(`[seguimiento] ${organizationId}:`, err);
        return 0;
      });
    }
  } catch (err) {
    console.error("[seguimiento] la tanda falló:", err);
  } finally {
    e.corriendo = false;
  }
  return enviados;
}

/** Último mensaje del cliente dentro de la ventana de algún paso. */
function ventanasDePasos(pasos: readonly Paso[], ahora: Date): SQL {
  const c = schema.conversation;
  const t = ahora.getTime();
  const rangos = pasos.map((p) =>
    and(
      lte(c.lastInboundAt, new Date(t - p.dias * DIA_MS)),
      gte(c.lastInboundAt, new Date(t - p.dias * DIA_MS - GRACIA_HORAS * HORA_MS))
    )
  );
  return or(...rangos)!;
}

async function revisarOrganizacion(organizationId: string, config: ConfigSeguimiento, ahora: Date): Promise<number> {
  const c = schema.conversation;
  const candidatas = await getDb()
    .select({ id: c.id })
    .from(c)
    .where(
      scoped(
        c.organizationId,
        organizationId,
        eq(c.isTest, false),
        eq(c.channel, "whatsapp"),
        ventanasDePasos(config.pasos, ahora)
      )
    )
    .orderBy(desc(c.lastInboundAt))
    .limit(200);

  let enviados = 0;
  for (const { id } of candidatas) {
    const ev = await evaluar(organizationId, id, config);
    if (ev.motivo || !ev.ancla) continue;
    const salidos = await diasYaSalidos(organizationId, id, ev.ancla);
    const paso = pasoQueToca(ahora, ev.ancla, config.pasos, salidos);
    if (!paso) continue;
    const envioId = await apartarEnvio({
      organizationId,
      conversationId: id,
      ancla: ev.ancla,
      dias: paso.dias,
      contacto: ev.contacto,
    });
    if (!envioId) continue; // ya salió (o lo está mandando otra pasada)
    const r = await mandar(organizationId, id, paso, ev.contacto);
    await cerrarEnvio(envioId, r.estado, r.detalle);
    if (r.estado === "enviado") enviados += 1;
  }
  return enviados;
}

async function mandar(
  organizationId: string,
  conversationId: string,
  paso: Paso,
  contacto: string
): Promise<{ estado: "enviado" | "omitido" | "fallido"; detalle: string | null }> {
  if (!paso.plantillaId) {
    return { estado: "omitido", detalle: `Sin plantilla elegida para el paso de ${describirDias(paso.dias)}` };
  }
  try {
    await sendTemplate({
      organizationId,
      conversationId,
      templateId: paso.plantillaId,
      variables: armarVariables(paso.variables, contacto),
    });
    return { estado: "enviado", detalle: `Plantilla del paso de ${describirDias(paso.dias)}` };
  } catch (err) {
    return { estado: "fallido", detalle: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * ¿Le toca seguimiento a esta conversación? `motivo` dice por qué no (para la
 * bandeja); null = sí corre. Es la misma regla para el revisor y la pantalla.
 */
export async function evaluar(
  organizationId: string,
  conversationId: string,
  config: ConfigSeguimiento
): Promise<{ motivo: string | null; ancla: Date | null; contacto: string; pausada: boolean }> {
  const db = getDb();
  const c = schema.conversation;
  const [fila] = await db
    .select({ conv: c, contacto: schema.contact.name })
    .from(c)
    .innerJoin(schema.contact, eq(c.contactId, schema.contact.id))
    .where(scoped(c.organizationId, organizationId, eq(c.id, conversationId)))
    .limit(1);
  if (!fila) return { motivo: "Conversación no encontrada", ancla: null, contacto: "", pausada: false };
  const { conv } = fila;
  const contacto = fila.contacto ?? "";
  const pausada = await estaPausada(organizationId, conversationId);
  const res = (motivo: string | null) => ({ motivo, ancla: conv.lastInboundAt, contacto, pausada });

  if (conv.isTest) return res("Es una conversación del Laboratorio");
  if (conv.channel !== "whatsapp") return res("Solo funciona en WhatsApp");
  if (pausada) return res("Lo detuviste para este cliente");
  if (!conv.lastInboundAt) return res("El cliente todavía no ha escrito");

  // Alguien ya le contestó después de su último mensaje.
  const [respondido] = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        gt(schema.message.createdAt, conv.lastInboundAt)
      )
    )
    .limit(1);
  if (!respondido) return res("Nadie le ha contestado su último mensaje");

  // La etapa del embudo.
  const [etapa] = await db
    .select({ id: schema.pipelineStage.id, kind: schema.pipelineStage.kind, nombre: schema.pipelineStage.name })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, conv.contactId)))
    .limit(1);
  if (etapa && etapa.kind !== "open") return res(`Está en «${etapa.nombre}»`);
  if (etapa && config.excluirEtapas.includes(etapa.id)) return res(`La etapa «${etapa.nombre}» no lleva seguimiento`);

  return res(null);
}

/** Lo que la bandeja enseña: si corre, por qué no, el siguiente paso y lo que ya salió. */
export async function estadoConversacion(
  organizationId: string,
  conversationId: string,
  ahora = new Date()
): Promise<EstadoConversacionDto> {
  const config = await leerConfig(organizationId);
  const [ev, enviados] = await Promise.all([
    evaluar(organizationId, conversationId, config),
    ultimosEnvios(organizationId, { conversationId, limite: 10 }),
  ]);
  let siguiente: EstadoConversacionDto["siguiente"] = null;
  if (config.activo && !ev.motivo && ev.ancla) {
    const salidos = await diasYaSalidos(organizationId, conversationId, ev.ancla);
    const s = siguientePaso(ahora, ev.ancla, config.pasos, salidos);
    // Uno que ya venció y sigue en la gracia sale en la próxima vuelta del revisor.
    const pendiente = pasoQueToca(ahora, ev.ancla, config.pasos, salidos);
    if (pendiente) siguiente = { dias: pendiente.dias, fecha: venceEn(ev.ancla, pendiente.dias).toISOString() };
    else if (s) siguiente = { dias: s.dias, fecha: s.fecha.toISOString() };
  }
  let motivo = ev.motivo;
  if (!motivo && config.activo && !siguiente) motivo = "Ya salieron todos los pasos";
  return { activo: config.activo, pausada: ev.pausada, motivo, siguiente, enviados };
}
