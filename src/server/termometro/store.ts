import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CALMA_MS,
  CONFIG_POR_DEFECTO,
  TEMPERATURAS,
  VENTANA_MS,
  configSchema,
  type Clasificacion,
  type ConfigTermometro,
  type Temperatura,
  type TermometroDto,
} from "@/lib/termometro";

/**
 * Módulo de la agencia — lo que guarda el termómetro del cliente.
 *
 * Como los demás módulos de la agencia, sus tablas NO van en `drizzle/`: se
 * crean solas, idempotentes, la primera vez. Una clasificación por
 * conversación (la última). `manual` = la corrigió una persona: la IA ya no
 * la toca hasta que la regresen a automático.
 */

export const termometroConfig = pgTable("agencia_termometro_config", {
  organizationId: text("organization_id").primaryKey(),
  activo: boolean("activo").notNull().default(true),
  criterio: text("criterio").notNull().default(""),
  etiquetas: jsonb("etiquetas").$type<unknown[]>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const termometro = pgTable("agencia_termometro", {
  conversationId: text("conversation_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  temperatura: text("temperatura"),
  etiquetas: jsonb("etiquetas").$type<string[]>().notNull(),
  razon: text("razon").notNull().default(""),
  manual: boolean("manual").notNull().default(false),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
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
    CREATE TABLE IF NOT EXISTS agencia_termometro_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      activo boolean NOT NULL DEFAULT true,
      criterio text NOT NULL DEFAULT '',
      etiquetas jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_termometro (
      conversation_id text PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      temperatura text,
      etiquetas jsonb NOT NULL DEFAULT '[]'::jsonb,
      razon text NOT NULL DEFAULT '',
      manual boolean NOT NULL DEFAULT false,
      actualizado_en timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agencia_termometro_org_idx ON agencia_termometro (organization_id)`);
}

export async function leerConfig(organizationId: string): Promise<ConfigTermometro> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(termometroConfig)
    .where(eq(termometroConfig.organizationId, organizationId))
    .limit(1);
  if (!f) return CONFIG_POR_DEFECTO;
  const r = configSchema.safeParse({
    activo: f.activo,
    criterio: f.criterio,
    ...(Array.isArray(f.etiquetas) ? { etiquetas: f.etiquetas } : {}),
  });
  return r.success ? r.data : { ...CONFIG_POR_DEFECTO, activo: f.activo };
}

export async function guardarConfig(organizationId: string, c: ConfigTermometro): Promise<ConfigTermometro> {
  await asegurarTablas();
  const valores = { activo: c.activo, criterio: c.criterio, etiquetas: c.etiquetas as unknown[] };
  await getDb()
    .insert(termometroConfig)
    .values({ organizationId, ...valores })
    .onConflictDoUpdate({ target: termometroConfig.organizationId, set: { ...valores, updatedAt: new Date() } });
  return leerConfig(organizationId);
}

/** Organizaciones con el termómetro encendido (las que no tienen fila van encendidas por defecto). */
export async function organizacionesActivas(): Promise<string[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select({ id: schema.organization.id, activo: termometroConfig.activo })
    .from(schema.organization)
    .leftJoin(termometroConfig, eq(termometroConfig.organizationId, schema.organization.id));
  return filas.filter((f) => f.activo !== false).map((f) => f.id);
}

/** Conversaciones que tocan: hubo mensajes desde la última clasificación (y no la corrigió una persona). */
export async function candidatas(organizationId: string, ahora: Date, forzar: boolean, limite: number) {
  await asegurarTablas();
  const c = schema.conversation;
  const hastaCalma = new Date(ahora.getTime() - (forzar ? 0 : CALMA_MS));
  const desdeVentana = new Date(ahora.getTime() - VENTANA_MS);
  return getDb()
    .select({
      id: c.id,
      contactId: c.contactId,
      lastMessageAt: c.lastMessageAt,
      clasificadoEn: termometro.actualizadoEn,
      manual: termometro.manual,
    })
    .from(c)
    .leftJoin(termometro, eq(termometro.conversationId, c.id))
    .where(
      scoped(
        c.organizationId,
        organizationId,
        eq(c.isTest, false),
        gt(c.lastMessageAt, desdeVentana),
        lt(c.lastMessageAt, hastaCalma),
        or(isNull(termometro.conversationId), and(eq(termometro.manual, false), lt(termometro.actualizadoEn, c.lastMessageAt)))
      )
    )
    .orderBy(sql`${c.lastMessageAt} desc`)
    .limit(limite);
}

export async function guardarClasificacion(
  organizationId: string,
  conversationId: string,
  cl: Clasificacion,
  opciones: { manual: boolean }
): Promise<void> {
  await asegurarTablas();
  const valores = {
    temperatura: cl.temperatura,
    etiquetas: cl.etiquetas,
    razon: cl.razon,
    manual: opciones.manual,
    actualizadoEn: new Date(),
  };
  const db = getDb();
  if (!opciones.manual) {
    // La IA no pisa lo que una persona corrigió mientras ella pensaba.
    await db
      .insert(termometro)
      .values({ conversationId, organizationId, ...valores })
      .onConflictDoUpdate({ target: termometro.conversationId, set: valores, setWhere: eq(termometro.manual, false) });
    return;
  }
  await db
    .insert(termometro)
    .values({ conversationId, organizationId, ...valores })
    .onConflictDoUpdate({ target: termometro.conversationId, set: valores });
}

/** «Regresar a automático»: quita la corrección y deja que la IA vuelva a clasificar. */
export async function volverAutomatico(organizationId: string, conversationId: string): Promise<void> {
  await asegurarTablas();
  await getDb()
    .update(termometro)
    .set({ manual: false, actualizadoEn: new Date(0) })
    .where(scoped(termometro.organizationId, organizationId, eq(termometro.conversationId, conversationId)));
}

function aDto(f: typeof termometro.$inferSelect): TermometroDto {
  const t = (TEMPERATURAS as readonly string[]).includes(f.temperatura ?? "") ? (f.temperatura as Temperatura) : null;
  return {
    temperatura: t,
    etiquetas: Array.isArray(f.etiquetas) ? f.etiquetas.filter((x): x is string => typeof x === "string") : [],
    razon: f.razon,
    manual: f.manual,
    actualizadoEn: f.actualizadoEn.toISOString(),
  };
}

export async function mapa(organizationId: string): Promise<Record<string, TermometroDto>> {
  await asegurarTablas();
  const filas = await getDb()
    .select()
    .from(termometro)
    .where(scoped(termometro.organizationId, organizationId))
    .limit(5000);
  const salida: Record<string, TermometroDto> = {};
  for (const f of filas) salida[f.conversationId] = aDto(f);
  return salida;
}

export async function existeConversacion(organizationId: string, conversationId: string): Promise<boolean> {
  const [f] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  return Boolean(f);
}
