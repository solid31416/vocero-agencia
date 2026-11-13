import { and, desc, eq, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  type ConfigSeguimiento,
  type EnvioDto,
  type Paso,
} from "@/lib/seguimiento";

/**
 * Módulo de la agencia — lo que guarda el seguimiento automático.
 *
 * Como los demás módulos, sus tablas NO van en `drizzle/` (las migraciones de
 * Vocero raíz se aplican por fecha y una propia en medio podría saltarse una
 * futura de Kevin): se crean solas, idempotentes, la primera vez.
 *
 * `agencia_seguimiento_envio` es bitácora y candado: un paso es
 * (conversación, último mensaje del cliente, días) y el UNIQUE impide
 * mandarlo dos veces. Si el cliente vuelve a escribir cambia el ancla, y la
 * serie empieza de nuevo.
 */

export const seguimientoConfig = pgTable("agencia_seguimiento_config", {
  organizationId: text("organization_id").primaryKey(),
  activo: boolean("activo").notNull().default(false),
  pasos: jsonb("pasos").$type<Paso[]>().notNull(),
  excluirEtapas: jsonb("excluir_etapas").$type<string[]>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const seguimientoEnvio = pgTable("agencia_seguimiento_envio", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  ancla: timestamp("ancla").notNull(),
  dias: integer("dias").notNull(),
  estado: text("estado", { enum: ["enviando", "enviado", "omitido", "fallido"] }).notNull(),
  detalle: text("detalle"),
  contacto: text("contacto"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Clientes a los que alguien le dijo «a este ya no le escribas solo». */
export const seguimientoPausa = pgTable("agencia_seguimiento_pausa", {
  conversationId: text("conversation_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  pausadaPor: text("pausada_por"),
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
    CREATE TABLE IF NOT EXISTS agencia_seguimiento_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      activo boolean NOT NULL DEFAULT false,
      pasos jsonb NOT NULL,
      excluir_etapas jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_seguimiento_envio (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      ancla timestamp NOT NULL,
      dias integer NOT NULL,
      estado text NOT NULL,
      detalle text,
      contacto text,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (conversation_id, ancla, dias)
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_seguimiento_envio_org_idx ON agencia_seguimiento_envio (organization_id, created_at)`
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_seguimiento_pausa (
      conversation_id text PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      pausada_por text,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
}

function aConfig(f: typeof seguimientoConfig.$inferSelect) {
  return configSchema.safeParse({ activo: f.activo, pasos: f.pasos, excluirEtapas: f.excluirEtapas });
}

export async function leerConfig(organizationId: string): Promise<ConfigSeguimiento> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(seguimientoConfig)
    .where(scoped(seguimientoConfig.organizationId, organizationId))
    .limit(1);
  if (!fila) return CONFIG_POR_DEFECTO;
  const r = aConfig(fila);
  return r.success ? r.data : { ...CONFIG_POR_DEFECTO, activo: false };
}

export async function guardarConfig(organizationId: string, c: ConfigSeguimiento): Promise<ConfigSeguimiento> {
  await asegurarTablas();
  const valores = { activo: c.activo, pasos: c.pasos, excluirEtapas: c.excluirEtapas, updatedAt: new Date() };
  await getDb()
    .insert(seguimientoConfig)
    .values({ organizationId, ...valores })
    .onConflictDoUpdate({ target: seguimientoConfig.organizationId, set: valores });
  return c;
}

export async function configsActivas(): Promise<{ organizationId: string; config: ConfigSeguimiento }[]> {
  await asegurarTablas();
  const filas = await getDb().select().from(seguimientoConfig).where(eq(seguimientoConfig.activo, true));
  return filas.flatMap((f) => {
    const r = aConfig(f);
    return r.success ? [{ organizationId: f.organizationId, config: r.data }] : [];
  });
}

/** Los días que ya salieron (o se intentaron) para esta conversación desde el último mensaje del cliente. */
export async function diasYaSalidos(organizationId: string, conversationId: string, ancla: Date): Promise<number[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select({ dias: seguimientoEnvio.dias })
    .from(seguimientoEnvio)
    .where(
      scoped(
        seguimientoEnvio.organizationId,
        organizationId,
        eq(seguimientoEnvio.conversationId, conversationId),
        eq(seguimientoEnvio.ancla, ancla)
      )
    );
  return filas.map((f) => f.dias);
}

/** Aparta un paso para mandarlo: el id si este proceso lo ganó, null si ya existía. */
export async function apartarEnvio(input: {
  organizationId: string;
  conversationId: string;
  ancla: Date;
  dias: number;
  contacto: string;
}): Promise<string | null> {
  const id = `seg_${nano()}`;
  const filas = await getDb()
    .insert(seguimientoEnvio)
    .values({ id, ...input, estado: "enviando" })
    .onConflictDoNothing()
    .returning({ id: seguimientoEnvio.id });
  return filas[0]?.id ?? null;
}

export async function cerrarEnvio(
  id: string,
  estado: "enviado" | "omitido" | "fallido",
  detalle: string | null
): Promise<void> {
  await getDb()
    .update(seguimientoEnvio)
    .set({ estado, detalle: detalle?.slice(0, 300) ?? null })
    .where(eq(seguimientoEnvio.id, id));
}

function aEnvioDto(f: typeof seguimientoEnvio.$inferSelect): EnvioDto {
  return {
    id: f.id,
    conversationId: f.conversationId,
    contacto: f.contacto ?? "",
    dias: f.dias,
    estado: f.estado,
    detalle: f.detalle,
    creadoEn: f.createdAt.toISOString(),
  };
}

export async function ultimosEnvios(
  organizationId: string,
  opciones: { conversationId?: string; limite?: number } = {}
): Promise<EnvioDto[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select()
    .from(seguimientoEnvio)
    .where(
      scoped(
        seguimientoEnvio.organizationId,
        organizationId,
        opciones.conversationId ? eq(seguimientoEnvio.conversationId, opciones.conversationId) : undefined
      )
    )
    .orderBy(desc(seguimientoEnvio.createdAt))
    .limit(opciones.limite ?? 20);
  return filas.map(aEnvioDto);
}

export async function estaPausada(organizationId: string, conversationId: string): Promise<boolean> {
  await asegurarTablas();
  const [f] = await getDb()
    .select({ id: seguimientoPausa.conversationId })
    .from(seguimientoPausa)
    .where(scoped(seguimientoPausa.organizationId, organizationId, eq(seguimientoPausa.conversationId, conversationId)))
    .limit(1);
  return Boolean(f);
}

export async function pausar(
  organizationId: string,
  conversationId: string,
  pausada: boolean,
  userId: string
): Promise<void> {
  await asegurarTablas();
  const db = getDb();
  if (pausada) {
    await db
      .insert(seguimientoPausa)
      .values({ conversationId, organizationId, pausadaPor: userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(seguimientoPausa)
      .where(
        and(eq(seguimientoPausa.organizationId, organizationId), eq(seguimientoPausa.conversationId, conversationId))
      );
  }
}
