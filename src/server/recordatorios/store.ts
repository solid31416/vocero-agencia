import { desc, eq, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  type AccionCita,
  type ConfigRecordatorios,
  type EnvioDto,
} from "@/lib/recordatorios";

/**
 * Módulo de la agencia — lo que guardan los recordatorios de cita.
 *
 * Como el Laboratorio a la medida, sus tablas NO van en `drizzle/` (las
 * migraciones de Vocero raíz se aplican por fecha y una propia en medio podría
 * saltarse una futura de Kevin): se crean solas, idempotentes, la primera vez.
 *
 * `agencia_recordatorio_envio` es a la vez la bitácora y el candado: un aviso
 * es (cita, instante de la cita, minutos antes) y el UNIQUE impide mandarlo
 * dos veces. Si la cita se reagenda cambia el instante, y sus avisos vuelven
 * a armarse para la hora nueva.
 */

export const recordatorioConfig = pgTable("agencia_recordatorio_config", {
  organizationId: text("organization_id").primaryKey(),
  activo: boolean("activo").notNull().default(false),
  avisos: jsonb("avisos").$type<number[]>().notNull(),
  texto: text("texto").notNull(),
  plantillaId: text("plantilla_id"),
  botones: boolean("botones"),
  textoConfirmo: text("texto_confirmo"),
  textoCancelo: text("texto_cancelo"),
  textoReagendar: text("texto_reagendar"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const recordatorioEnvio = pgTable("agencia_recordatorio_envio", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  bookingId: text("booking_id").notNull(),
  citaEn: timestamp("cita_en").notNull(),
  minutos: integer("minutos").notNull(),
  estado: text("estado", { enum: ["enviando", "enviado", "omitido", "fallido"] }).notNull(),
  detalle: text("detalle"),
  contacto: text("contacto"),
  respuesta: text("respuesta", { enum: ["confirmo", "reagendar", "cancelo"] }),
  respuestaEn: timestamp("respuesta_en"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Cada toque de botón ya atendido (por su wamid): un reintento de Meta no lo atiende dos veces. */
export const recordatorioRespuesta = pgTable("agencia_recordatorio_respuesta", {
  waMessageId: text("wa_message_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  envioId: text("envio_id").notNull(),
  accion: text("accion").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);

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
    CREATE TABLE IF NOT EXISTS agencia_recordatorio_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      activo boolean NOT NULL DEFAULT false,
      avisos jsonb NOT NULL,
      texto text NOT NULL,
      plantilla_id text,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_recordatorio_envio (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      booking_id text NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
      cita_en timestamp NOT NULL,
      minutos integer NOT NULL,
      estado text NOT NULL,
      detalle text,
      contacto text,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (booking_id, cita_en, minutos)
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_recordatorio_envio_org_idx ON agencia_recordatorio_envio (organization_id, created_at)`
  );
  // Botones Confirmo / Reagendar / Cancelar (se agregaron después: columnas nuevas, si faltan).
  await db.execute(sql`ALTER TABLE agencia_recordatorio_config ADD COLUMN IF NOT EXISTS botones boolean`);
  await db.execute(sql`ALTER TABLE agencia_recordatorio_config ADD COLUMN IF NOT EXISTS texto_confirmo text`);
  await db.execute(sql`ALTER TABLE agencia_recordatorio_config ADD COLUMN IF NOT EXISTS texto_cancelo text`);
  await db.execute(sql`ALTER TABLE agencia_recordatorio_config ADD COLUMN IF NOT EXISTS texto_reagendar text`);
  await db.execute(sql`ALTER TABLE agencia_recordatorio_envio ADD COLUMN IF NOT EXISTS respuesta text`);
  await db.execute(sql`ALTER TABLE agencia_recordatorio_envio ADD COLUMN IF NOT EXISTS respuesta_en timestamp`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_recordatorio_respuesta (
      wa_message_id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      envio_id text NOT NULL REFERENCES agencia_recordatorio_envio(id) ON DELETE CASCADE,
      accion text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
}

/** Lo guardado → la configuración; las columnas nuevas vacías toman su valor por defecto. */
function aConfig(f: typeof recordatorioConfig.$inferSelect) {
  return configSchema.safeParse({
    activo: f.activo,
    avisos: f.avisos,
    texto: f.texto,
    plantillaId: f.plantillaId,
    botones: f.botones ?? undefined,
    textoConfirmo: f.textoConfirmo ?? undefined,
    textoCancelo: f.textoCancelo ?? undefined,
    textoReagendar: f.textoReagendar ?? undefined,
  });
}

export async function leerConfig(organizationId: string): Promise<ConfigRecordatorios> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(recordatorioConfig)
    .where(scoped(recordatorioConfig.organizationId, organizationId))
    .limit(1);
  if (!fila) return CONFIG_POR_DEFECTO;
  const r = aConfig(fila);
  return r.success ? r.data : { ...CONFIG_POR_DEFECTO, activo: fila.activo };
}

export async function guardarConfig(
  organizationId: string,
  c: ConfigRecordatorios
): Promise<ConfigRecordatorios> {
  await asegurarTablas();
  const valores = {
    activo: c.activo,
    avisos: c.avisos,
    texto: c.texto,
    plantillaId: c.plantillaId,
    botones: c.botones,
    textoConfirmo: c.textoConfirmo,
    textoCancelo: c.textoCancelo,
    textoReagendar: c.textoReagendar,
  };
  await getDb()
    .insert(recordatorioConfig)
    .values({ organizationId, ...valores, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: recordatorioConfig.organizationId,
      set: { ...valores, updatedAt: new Date() },
    });
  return c;
}

/** Las organizaciones con recordatorios encendidos. */
export async function configsActivas(): Promise<
  { organizationId: string; config: ConfigRecordatorios }[]
> {
  await asegurarTablas();
  const filas = await getDb()
    .select()
    .from(recordatorioConfig)
    .where(eq(recordatorioConfig.activo, true));
  return filas.flatMap((f) => {
    const r = aConfig(f);
    return r.success && r.data.avisos.length ? [{ organizationId: f.organizationId, config: r.data }] : [];
  });
}

/**
 * Aparta un aviso para mandarlo. Devuelve el id si este proceso lo ganó, o
 * null si ya existía (mandado, omitido o en curso): así nunca sale dos veces.
 */
export async function apartarEnvio(input: {
  organizationId: string;
  bookingId: string;
  citaEn: Date;
  minutos: number;
  contacto: string;
}): Promise<string | null> {
  const id = `rec_${nano()}`;
  const filas = await getDb()
    .insert(recordatorioEnvio)
    .values({ id, ...input, estado: "enviando" })
    .onConflictDoNothing()
    .returning({ id: recordatorioEnvio.id });
  return filas[0]?.id ?? null;
}

export async function cerrarEnvio(
  id: string,
  estado: "enviado" | "omitido" | "fallido",
  detalle: string | null
): Promise<void> {
  await getDb()
    .update(recordatorioEnvio)
    .set({ estado, detalle: detalle?.slice(0, 300) ?? null })
    .where(eq(recordatorioEnvio.id, id));
}

export async function ultimosEnvios(organizationId: string, limite = 15): Promise<EnvioDto[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select()
    .from(recordatorioEnvio)
    .where(scoped(recordatorioEnvio.organizationId, organizationId))
    .orderBy(desc(recordatorioEnvio.createdAt))
    .limit(limite);
  return filas.map((f) => ({
    id: f.id,
    contacto: f.contacto ?? "",
    cita: f.citaEn.toISOString(),
    minutos: f.minutos,
    estado: f.estado,
    detalle: f.detalle,
    respuesta: f.respuesta ?? null,
    creadoEn: f.createdAt.toISOString(),
  }));
}

/* ─────────────── Respuestas con los botones ─────────────── */

export async function envioPorId(organizationId: string, id: string) {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(recordatorioEnvio)
    .where(scoped(recordatorioEnvio.organizationId, organizationId, eq(recordatorioEnvio.id, id)))
    .limit(1);
  return f ?? null;
}

/** Aparta un toque de botón para atenderlo; false si ya se atendió (reintento de Meta). */
export async function apartarRespuesta(input: {
  organizationId: string;
  waMessageId: string;
  envioId: string;
  accion: AccionCita;
}): Promise<boolean> {
  await asegurarTablas();
  const filas = await getDb()
    .insert(recordatorioRespuesta)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: recordatorioRespuesta.waMessageId });
  return filas.length > 0;
}

export async function anotarRespuesta(envioId: string, accion: AccionCita): Promise<void> {
  await getDb()
    .update(recordatorioEnvio)
    .set({ respuesta: accion, respuestaEn: new Date() })
    .where(eq(recordatorioEnvio.id, envioId));
}
