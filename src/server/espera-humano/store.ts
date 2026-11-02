import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  horarioSchema,
  type ConfigEspera,
  type Horario,
} from "@/lib/espera-humano";

/**
 * Módulo de la agencia — lo que guarda «Nadie ha contestado».
 *
 * Como los demás módulos de la agencia, sus tablas NO van en `drizzle/`: se
 * crean solas, idempotentes, la primera vez. La espera no se guarda: se
 * calcula de los mensajes. Solo se guardan los avisos ya mandados (uno por
 * espera y tipo), para no repetirlos.
 */

export const esperaConfig = pgTable("agencia_espera_config", {
  organizationId: text("organization_id").primaryKey(),
  activo: boolean("activo").notNull().default(true),
  mensajeCliente: boolean("mensaje_cliente").notNull().default(true),
  minutosCliente: integer("minutos_cliente").notNull().default(10),
  textoCliente: text("texto_cliente").notNull(),
  textoFuera: text("texto_fuera").notNull(),
  avisarDueno: boolean("avisar_dueno").notNull().default(false),
  minutosDueno: integer("minutos_dueno").notNull().default(30),
  telefonoDueno: text("telefono_dueno"),
  horario: jsonb("horario").$type<unknown>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const esperaAviso = pgTable("agencia_espera_aviso", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  tipo: text("tipo", { enum: ["cliente", "dueno"] }).notNull(),
  desde: timestamp("desde").notNull(),
  enviadoEn: timestamp("enviado_en").notNull().defaultNow(),
  resultado: text("resultado").notNull().default(""),
});

let listas: Promise<void> | null = null;

export function asegurarTablas(): Promise<void> {
  listas ??= crear().catch((err) => {
    listas = null;
    throw err;
  });
  return listas;
}

async function crear(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_espera_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      activo boolean NOT NULL DEFAULT true,
      mensaje_cliente boolean NOT NULL DEFAULT true,
      minutos_cliente integer NOT NULL DEFAULT 10,
      texto_cliente text NOT NULL,
      texto_fuera text NOT NULL,
      avisar_dueno boolean NOT NULL DEFAULT false,
      minutos_dueno integer NOT NULL DEFAULT 30,
      telefono_dueno text,
      horario jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_espera_aviso (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      tipo text NOT NULL,
      desde timestamp NOT NULL,
      enviado_en timestamp NOT NULL DEFAULT now(),
      resultado text NOT NULL DEFAULT ''
    )`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agencia_espera_aviso_uq
      ON agencia_espera_aviso (conversation_id, tipo, desde)`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agencia_espera_aviso_org_idx ON agencia_espera_aviso (organization_id, enviado_en)`);
}

/** Sin configuración guardada, el horario sale de la agenda (si la hay). */
async function horarioDeLaAgenda(organizationId: string): Promise<Horario | null> {
  const [f] = await getDb()
    .select({ weeklyHours: schema.calendarSettings.weeklyHours })
    .from(schema.calendarSettings)
    .where(eq(schema.calendarSettings.organizationId, organizationId))
    .limit(1);
  const r = horarioSchema.safeParse(f?.weeklyHours);
  return r.success && Object.values(r.data).some((x) => (x?.length ?? 0) > 0) ? r.data : null;
}

export async function leerConfig(organizationId: string): Promise<ConfigEspera> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(esperaConfig)
    .where(eq(esperaConfig.organizationId, organizationId))
    .limit(1);
  if (!f) {
    const horario = await horarioDeLaAgenda(organizationId);
    return horario ? { ...CONFIG_POR_DEFECTO, horario } : CONFIG_POR_DEFECTO;
  }
  const r = configSchema.safeParse({
    activo: f.activo,
    mensajeCliente: f.mensajeCliente,
    minutosCliente: f.minutosCliente,
    textoCliente: f.textoCliente,
    textoFuera: f.textoFuera,
    // Guardado apagado sin teléfono es válido; encendido sin teléfono no pasa el esquema.
    avisarDueno: f.avisarDueno && Boolean(f.telefonoDueno),
    minutosDueno: f.minutosDueno,
    telefonoDueno: f.telefonoDueno,
    ...(f.horario ? { horario: f.horario } : {}),
  });
  return r.success ? r.data : { ...CONFIG_POR_DEFECTO, activo: f.activo };
}

export async function guardarConfig(organizationId: string, c: ConfigEspera): Promise<ConfigEspera> {
  await asegurarTablas();
  const valores = {
    activo: c.activo,
    mensajeCliente: c.mensajeCliente,
    minutosCliente: c.minutosCliente,
    textoCliente: c.textoCliente,
    textoFuera: c.textoFuera,
    avisarDueno: c.avisarDueno,
    minutosDueno: c.minutosDueno,
    telefonoDueno: c.telefonoDueno,
    horario: c.horario as unknown,
  };
  await getDb()
    .insert(esperaConfig)
    .values({ organizationId, ...valores })
    .onConflictDoUpdate({ target: esperaConfig.organizationId, set: { ...valores, updatedAt: new Date() } });
  return leerConfig(organizationId);
}

/** Organizaciones con el módulo encendido (las que no tienen fila van encendidas por defecto). */
export async function organizacionesActivas(): Promise<string[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select({ id: schema.organization.id, activo: esperaConfig.activo })
    .from(schema.organization)
    .leftJoin(esperaConfig, eq(esperaConfig.organizationId, schema.organization.id));
  return filas.filter((f) => f.activo !== false).map((f) => f.id);
}

export type FilaPausada = {
  conversationId: string;
  nombre: string;
  handoffAt: Date | null;
  handoffReason: string | null;
  ultimaHumana: Date | null;
  primeraEntradaSinRespuesta: Date | null;
  ultimoTexto: string;
  ultimoTipo: string;
};

const aFecha = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(Number(v)));

/**
 * Conversaciones reales con la IA pausada y movimiento en los últimos 7 días,
 * con lo necesario para calcular la espera: la última respuesta de una
 * persona y el primer mensaje del cliente después de lo último que mandó el
 * negocio. Las fechas salen en milisegundos (epoch) para no depender de la
 * zona de la sesión.
 */
export async function conversacionesPausadas(organizationId: string): Promise<FilaPausada[]> {
  const filas = (await getDb().execute(sql`
    SELECT c.id,
           ct.name AS nombre,
           c.handoff_reason,
           extract(epoch FROM c.handoff_at) * 1000 AS handoff_at,
           extract(epoch FROM h.t) * 1000 AS ultima_humana,
           extract(epoch FROM i.t) * 1000 AS primera_entrada,
           u.text AS ultimo_texto,
           u.type AS ultimo_tipo
      FROM conversation c
      JOIN contact ct ON ct.id = c.contact_id
      LEFT JOIN LATERAL (
        SELECT max(m.created_at) AS t FROM message m
         WHERE m.conversation_id = c.id AND m.direction = 'out' AND m.ai_generated = false
           AND m.origin IN ('operator', 'manual', 'template')
      ) h ON true
      LEFT JOIN LATERAL (
        SELECT max(m.created_at) AS t FROM message m
         WHERE m.conversation_id = c.id AND m.direction = 'out'
      ) o ON true
      LEFT JOIN LATERAL (
        SELECT min(m.created_at) AS t FROM message m
         WHERE m.conversation_id = c.id AND m.direction = 'in' AND (o.t IS NULL OR m.created_at > o.t)
      ) i ON true
      LEFT JOIN LATERAL (
        SELECT m.text, m.type FROM message m
         WHERE m.conversation_id = c.id AND m.direction = 'in'
         ORDER BY m.created_at DESC LIMIT 1
      ) u ON true
     WHERE c.organization_id = ${organizationId}
       AND c.is_test = false
       AND (c.ai_enabled = false OR c.handoff_at IS NOT NULL)
       AND c.last_message_at > (now() AT TIME ZONE 'utc') - interval '7 days'
  `)) as unknown as Record<string, unknown>[];
  return filas.map((f) => ({
    conversationId: String(f.id),
    nombre: String(f.nombre ?? ""),
    handoffAt: aFecha(f.handoff_at),
    handoffReason: (f.handoff_reason as string | null) ?? null,
    ultimaHumana: aFecha(f.ultima_humana),
    primeraEntradaSinRespuesta: aFecha(f.primera_entrada),
    ultimoTexto: String(f.ultimo_texto ?? ""),
    ultimoTipo: String(f.ultimo_tipo ?? "text"),
  }));
}

export type AvisoGuardado = { conversationId: string; tipo: "cliente" | "dueno"; desde: Date; enviadoEn: Date };

export const llaveAviso = (conversationId: string, tipo: string, desde: Date) =>
  `${conversationId}|${tipo}|${desde.getTime()}`;

/** Los avisos de los últimos 8 días, por llave conversación|tipo|desde. */
export async function avisosRecientes(organizationId: string): Promise<Map<string, AvisoGuardado>> {
  await asegurarTablas();
  const desde = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const filas = await getDb()
    .select({
      conversationId: esperaAviso.conversationId,
      tipo: esperaAviso.tipo,
      desde: esperaAviso.desde,
      enviadoEn: esperaAviso.enviadoEn,
    })
    .from(esperaAviso)
    .where(scoped(esperaAviso.organizationId, organizationId, gt(esperaAviso.enviadoEn, desde)));
  return new Map(filas.map((f) => [llaveAviso(f.conversationId, f.tipo, f.desde), f]));
}

/** Aparta el aviso ANTES de mandarlo: si otro ya lo apartó, devuelve null y no se manda dos veces. */
export async function apartarAviso(
  organizationId: string,
  conversationId: string,
  tipo: "cliente" | "dueno",
  desde: Date
): Promise<string | null> {
  await asegurarTablas();
  const id = `esp_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const filas = await getDb()
    .insert(esperaAviso)
    .values({ id, organizationId, conversationId, tipo, desde })
    .onConflictDoNothing()
    .returning({ id: esperaAviso.id });
  return filas[0]?.id ?? null;
}

export async function anotarResultado(organizationId: string, id: string, resultado: string): Promise<void> {
  await getDb()
    .update(esperaAviso)
    .set({ resultado: resultado.slice(0, 500) })
    .where(and(eq(esperaAviso.id, id), eq(esperaAviso.organizationId, organizationId)));
}
