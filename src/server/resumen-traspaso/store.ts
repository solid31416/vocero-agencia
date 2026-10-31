import { eq, sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  resumenSchema,
  type ConfigResumen,
  type Resumen,
  type ResumenDto,
} from "@/lib/resumen-traspaso";

/**
 * Módulo de la agencia — lo que guarda el resumen para quien atiende.
 *
 * Como los demás módulos de la agencia, sus tablas NO van en `drizzle/`: se
 * crean solas, idempotentes, la primera vez. Un resumen por conversación (el
 * último): `hasta_mensaje_id` dice hasta qué mensaje leyó, para no volver a
 * pagarle a la IA si no hubo nada nuevo.
 */

export const resumenConfig = pgTable("agencia_resumen_config", {
  organizationId: text("organization_id").primaryKey(),
  activo: boolean("activo").notNull().default(true),
  avisarDueno: boolean("avisar_dueno").notNull().default(false),
  telefonoDueno: text("telefono_dueno"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const resumenTraspaso = pgTable("agencia_resumen_traspaso", {
  conversationId: text("conversation_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  motivo: text("motivo").notNull(),
  resumen: jsonb("resumen").$type<Resumen>().notNull(),
  hastaMensajeId: text("hasta_mensaje_id"),
  generadoEn: timestamp("generado_en").notNull().defaultNow(),
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
    CREATE TABLE IF NOT EXISTS agencia_resumen_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      activo boolean NOT NULL DEFAULT true,
      avisar_dueno boolean NOT NULL DEFAULT false,
      telefono_dueno text,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_resumen_traspaso (
      conversation_id text PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      motivo text NOT NULL,
      resumen jsonb NOT NULL,
      hasta_mensaje_id text,
      generado_en timestamp NOT NULL DEFAULT now()
    )`);
}

export async function leerConfig(organizationId: string): Promise<ConfigResumen> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(resumenConfig)
    .where(eq(resumenConfig.organizationId, organizationId))
    .limit(1);
  if (!f) return CONFIG_POR_DEFECTO;
  const r = configSchema.safeParse({
    activo: f.activo,
    avisarDueno: f.avisarDueno,
    telefonoDueno: f.telefonoDueno,
  });
  return r.success ? r.data : CONFIG_POR_DEFECTO;
}

export async function guardarConfig(organizationId: string, c: ConfigResumen): Promise<ConfigResumen> {
  await asegurarTablas();
  const valores = { activo: c.activo, avisarDueno: c.avisarDueno, telefonoDueno: c.telefonoDueno };
  await getDb()
    .insert(resumenConfig)
    .values({ organizationId, ...valores })
    .onConflictDoUpdate({ target: resumenConfig.organizationId, set: { ...valores, updatedAt: new Date() } });
  return leerConfig(organizationId);
}

export async function leerResumen(organizationId: string, conversationId: string) {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(resumenTraspaso)
    .where(scoped(resumenTraspaso.organizationId, organizationId, eq(resumenTraspaso.conversationId, conversationId)))
    .limit(1);
  return f ?? null;
}

export function aDto(f: typeof resumenTraspaso.$inferSelect): ResumenDto {
  const r = resumenSchema.safeParse(f.resumen);
  return {
    resumen: r.success ? r.data : { quien: "", quiere: "", yaSeDijo: "", falta: "", animo: "" },
    motivo: f.motivo,
    generadoEn: f.generadoEn.toISOString(),
  };
}

export async function guardarResumen(input: {
  organizationId: string;
  conversationId: string;
  motivo: string;
  resumen: Resumen;
  hastaMensajeId: string | null;
}): Promise<void> {
  await asegurarTablas();
  const valores = {
    motivo: input.motivo,
    resumen: input.resumen,
    hastaMensajeId: input.hastaMensajeId,
    generadoEn: new Date(),
  };
  await getDb()
    .insert(resumenTraspaso)
    .values({ organizationId: input.organizationId, conversationId: input.conversationId, ...valores })
    .onConflictDoUpdate({ target: resumenTraspaso.conversationId, set: valores });
}
