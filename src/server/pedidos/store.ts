import { and, desc, eq, sql } from "drizzle-orm";
import { boolean, date, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  folioDe,
  indiceDeEtapa,
  type ConfigPedidos,
  type Movimiento,
  type PedidoDto,
} from "@/lib/pedidos";

/**
 * Módulo de la agencia — lo que guarda el estado del pedido.
 *
 * Como los demás módulos, sus tablas NO van en `drizzle/` (las migraciones de
 * Vocero raíz se aplican por fecha y una propia en medio podría saltarse una
 * futura de Kevin): se crean solas, idempotentes, la primera vez.
 *
 * El nombre de la etapa se copia al pedido y a cada movimiento: si el dueño
 * renombra o quita una etapa en Ajustes, los pedidos viejos se siguen leyendo.
 */

export const pedidoConfig = pgTable("agencia_pedido_config", {
  organizationId: text("organization_id").primaryKey(),
  config: jsonb("config").$type<ConfigPedidos>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const pedido = pgTable("agencia_pedido", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  numero: integer("numero").notNull(),
  conversationId: text("conversation_id"),
  contactId: text("contact_id"),
  contactoNombre: text("contacto_nombre").notNull(),
  concepto: text("concepto").notNull(),
  monto: numeric("monto", { mode: "number" }),
  fechaEstimada: date("fecha_estimada", { mode: "string" }),
  etapaId: text("etapa_id").notNull(),
  etapaNombre: text("etapa_nombre").notNull(),
  historial: jsonb("historial").$type<Movimiento[]>().notNull(),
  cotizacionId: text("cotizacion_id"),
  notas: text("notas").notNull().default(""),
  borrado: boolean("borrado").notNull().default(false),
  creadoPor: text("creado_por"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FilaPedido = typeof pedido.$inferSelect;

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
    CREATE TABLE IF NOT EXISTS agencia_pedido_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      config jsonb NOT NULL,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_pedido (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      numero integer NOT NULL,
      conversation_id text REFERENCES conversation(id) ON DELETE SET NULL,
      contact_id text REFERENCES contact(id) ON DELETE SET NULL,
      contacto_nombre text NOT NULL,
      concepto text NOT NULL,
      monto numeric,
      fecha_estimada date,
      etapa_id text NOT NULL,
      etapa_nombre text NOT NULL,
      historial jsonb NOT NULL DEFAULT '[]'::jsonb,
      cotizacion_id text,
      notas text NOT NULL DEFAULT '',
      borrado boolean NOT NULL DEFAULT false,
      creado_por text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (organization_id, numero)
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_pedido_org_idx ON agencia_pedido (organization_id, updated_at)`
  );
}

export async function leerConfig(organizationId: string): Promise<ConfigPedidos> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(pedidoConfig)
    .where(scoped(pedidoConfig.organizationId, organizationId))
    .limit(1);
  if (!fila) return CONFIG_POR_DEFECTO;
  const r = configSchema.safeParse(fila.config);
  return r.success ? r.data : CONFIG_POR_DEFECTO;
}

export async function guardarConfig(organizationId: string, c: ConfigPedidos): Promise<ConfigPedidos> {
  await asegurarTablas();
  await getDb()
    .insert(pedidoConfig)
    .values({ organizationId, config: c, updatedAt: new Date() })
    .onConflictDoUpdate({ target: pedidoConfig.organizationId, set: { config: c, updatedAt: new Date() } });
  return c;
}

export function aDto(f: FilaPedido, config: ConfigPedidos): PedidoDto {
  return {
    id: f.id,
    folio: folioDe(f.numero),
    conversationId: f.conversationId,
    contactoNombre: f.contactoNombre,
    concepto: f.concepto,
    monto: f.monto === null ? null : Number(f.monto),
    fechaEstimada: f.fechaEstimada,
    etapaId: f.etapaId,
    etapaNombre: f.etapaNombre,
    etapaIndice: indiceDeEtapa(config.etapas, f.etapaId),
    totalEtapas: config.etapas.length,
    historial: f.historial,
    cotizacionId: f.cotizacionId,
    notas: f.notas,
    creadoEn: f.createdAt.toISOString(),
    actualizadoEn: f.updatedAt.toISOString(),
  };
}

export async function leerPedido(organizationId: string, id: string): Promise<FilaPedido | null> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(pedido)
    .where(scoped(pedido.organizationId, organizationId, eq(pedido.id, id), eq(pedido.borrado, false)))
    .limit(1);
  return f ?? null;
}

export async function listarPedidos(
  organizationId: string,
  opciones: { conversationId?: string; limite?: number } = {}
): Promise<FilaPedido[]> {
  await asegurarTablas();
  return getDb()
    .select()
    .from(pedido)
    .where(
      scoped(
        pedido.organizationId,
        organizationId,
        eq(pedido.borrado, false),
        opciones.conversationId ? eq(pedido.conversationId, opciones.conversationId) : undefined
      )
    )
    .orderBy(desc(pedido.updatedAt))
    .limit(opciones.limite ?? 300);
}

export async function contactoDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<{ contactId: string; nombre: string; isTest: boolean } | null> {
  const [f] = await getDb()
    .select({ contactId: schema.contact.id, nombre: schema.contact.name, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  return f ?? null;
}

/** Inserta con el folio siguiente; si otro tomó el mismo número al mismo tiempo, reintenta. */
export async function insertarPedido(
  valores: Omit<typeof pedido.$inferInsert, "id" | "numero">
): Promise<FilaPedido | null> {
  await asegurarTablas();
  const db = getDb();
  for (let intento = 0; intento < 5; intento++) {
    const [max] = await db
      .select({ n: sql<number>`coalesce(max(${pedido.numero}), 0)` })
      .from(pedido)
      .where(eq(pedido.organizationId, valores.organizationId));
    const numero = Number(max?.n ?? 0) + 1;
    try {
      const [f] = await db
        .insert(pedido)
        .values({ id: `ped_${nano()}`, numero, ...valores })
        .returning();
      return f ?? null;
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code !== "23505" && e.cause?.code !== "23505" && !String(err).includes("23505")) throw err;
    }
  }
  return null;
}

export async function actualizarPedido(
  organizationId: string,
  id: string,
  valores: Partial<typeof pedido.$inferInsert>
): Promise<FilaPedido | null> {
  const [f] = await getDb()
    .update(pedido)
    .set({ ...valores, updatedAt: new Date() })
    .where(and(eq(pedido.organizationId, organizationId), eq(pedido.id, id)))
    .returning();
  return f ?? null;
}
