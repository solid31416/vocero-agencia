import { desc, eq, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
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
}

export async function leerConfig(organizationId: string): Promise<ConfigRecordatorios> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(recordatorioConfig)
    .where(scoped(recordatorioConfig.organizationId, organizationId))
    .limit(1);
  if (!fila) return CONFIG_POR_DEFECTO;
  const r = configSchema.safeParse({
    activo: fila.activo,
    avisos: fila.avisos,
    texto: fila.texto,
    plantillaId: fila.plantillaId,
  });
  return r.success ? r.data : { ...CONFIG_POR_DEFECTO, activo: fila.activo };
}

export async function guardarConfig(
  organizationId: string,
  c: ConfigRecordatorios
): Promise<ConfigRecordatorios> {
  await asegurarTablas();
  const valores = { activo: c.activo, avisos: c.avisos, texto: c.texto, plantillaId: c.plantillaId };
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
    const r = configSchema.safeParse({
      activo: f.activo,
      avisos: f.avisos,
      texto: f.texto,
      plantillaId: f.plantillaId,
    });
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
    creadoEn: f.createdAt.toISOString(),
  }));
}
