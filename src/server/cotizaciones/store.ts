import { and, desc, eq, gte, sql } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  calcularTotales,
  CONFIG_POR_DEFECTO,
  configSchema,
  estadoVisible,
  folioDe,
  type ConfigCotizaciones,
  type CotizacionDto,
  type CotizacionInput,
  type EstadoCotizacion,
  type Partida,
  type Totales,
} from "@/lib/cotizaciones";

/**
 * Módulo de la agencia — lo que guardan las cotizaciones.
 *
 * Como los demás módulos, sus tablas NO van en `drizzle/` (las migraciones de
 * Vocero raíz se aplican por fecha y una propia en medio podría saltarse una
 * futura de Kevin): se crean solas, idempotentes, la primera vez.
 *
 * El folio es un consecutivo por organización (`numero`, UNIQUE con la org):
 * si dos personas cotizan a la vez, la segunda reintenta con el siguiente.
 */

export const cotizacionConfig = pgTable("agencia_cotizacion_config", {
  organizationId: text("organization_id").primaryKey(),
  config: jsonb("config").$type<ConfigCotizaciones>().notNull(),
  logoBase64: text("logo_base64"),
  logoMime: text("logo_mime"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cotizacion = pgTable("agencia_cotizacion", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  numero: integer("numero").notNull(),
  conversationId: text("conversation_id"),
  contactId: text("contact_id"),
  contactoNombre: text("contacto_nombre").notNull(),
  estado: text("estado").$type<EstadoCotizacion>().notNull(),
  partidas: jsonb("partidas").$type<Partida[]>().notNull(),
  descuentoPct: numeric("descuento_pct", { mode: "number" }).notNull(),
  notas: text("notas").notNull(),
  totales: jsonb("totales").$type<Totales>().notNull(),
  /** Copia de las condiciones con las que se emitió (cambiar Ajustes no altera las ya hechas). */
  condiciones: jsonb("condiciones").$type<Omit<ConfigCotizaciones, "productos">>().notNull(),
  venceEn: timestamp("vence_en"),
  enviadaEn: timestamp("enviada_en"),
  messageId: text("message_id"),
  creadaPor: text("creada_por"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** Seguimiento detenido a mano para esta cotización. */
  seguimientoPausado: boolean("seguimiento_pausado").notNull().default(false),
  /** El cliente parece haber dicho que sí. */
  senalTexto: text("senal_texto"),
  senalEn: timestamp("senal_en"),
  /** Hasta qué mensaje del cliente ya se revisó buscando el «sí». */
  senalRevisadaHasta: timestamp("senal_revisada_hasta"),
  /** Módulo de la agencia (vendedor): «agente» si la mandó el agente solo. */
  enviadaPor: text("enviada_por"),
  /** Corrige a esta cotización (que queda «reemplazada» al mandar esta). */
  reemplazaA: text("reemplaza_a"),
});

/** Quien arma la cotización cuando es el agente (en `creada_por`). */
export const CREADA_POR_AGENTE = "agente";

/** Los recordatorios que salieron (o se intentaron) por cotización: uno de cada tipo. */
export const cotizacionToque = pgTable("agencia_cotizacion_toque", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  cotizacionId: text("cotizacion_id").notNull(),
  conversationId: text("conversation_id"),
  toque: text("toque").$type<"texto" | "plantilla">().notNull(),
  estado: text("estado").$type<"enviando" | "enviado" | "omitido" | "fallido">().notNull(),
  detalle: text("detalle"),
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
    CREATE TABLE IF NOT EXISTS agencia_cotizacion_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      config jsonb NOT NULL,
      logo_base64 text,
      logo_mime text,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_cotizacion (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      numero integer NOT NULL,
      conversation_id text REFERENCES conversation(id) ON DELETE SET NULL,
      contact_id text REFERENCES contact(id) ON DELETE SET NULL,
      contacto_nombre text NOT NULL,
      estado text NOT NULL,
      partidas jsonb NOT NULL,
      descuento_pct numeric NOT NULL DEFAULT 0,
      notas text NOT NULL DEFAULT '',
      totales jsonb NOT NULL,
      condiciones jsonb NOT NULL,
      vence_en timestamp,
      enviada_en timestamp,
      message_id text,
      creada_por text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (organization_id, numero)
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_cotizacion_conv_idx ON agencia_cotizacion (organization_id, conversation_id, created_at)`
  );
  // Seguimiento sin respuesta y el «sí» del cliente (2026-11-16): aditivo.
  await db.execute(
    sql`ALTER TABLE agencia_cotizacion ADD COLUMN IF NOT EXISTS seguimiento_pausado boolean NOT NULL DEFAULT false`
  );
  await db.execute(sql`ALTER TABLE agencia_cotizacion ADD COLUMN IF NOT EXISTS senal_texto text`);
  await db.execute(sql`ALTER TABLE agencia_cotizacion ADD COLUMN IF NOT EXISTS senal_en timestamp`);
  await db.execute(sql`ALTER TABLE agencia_cotizacion ADD COLUMN IF NOT EXISTS senal_revisada_hasta timestamp`);
  // El agente como vendedor y las correcciones (2026-11-17): aditivo.
  await db.execute(sql`ALTER TABLE agencia_cotizacion ADD COLUMN IF NOT EXISTS enviada_por text`);
  await db.execute(sql`ALTER TABLE agencia_cotizacion ADD COLUMN IF NOT EXISTS reemplaza_a text`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_cotizacion_toque (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      cotizacion_id text NOT NULL REFERENCES agencia_cotizacion(id) ON DELETE CASCADE,
      conversation_id text,
      toque text NOT NULL,
      estado text NOT NULL,
      detalle text,
      created_at timestamp NOT NULL DEFAULT now(),
      UNIQUE (cotizacion_id, toque)
    )`);
}

// ------------------------------------------------------------------ config

export async function leerConfig(organizationId: string): Promise<ConfigCotizaciones> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select({ config: cotizacionConfig.config })
    .from(cotizacionConfig)
    .where(scoped(cotizacionConfig.organizationId, organizationId))
    .limit(1);
  if (!fila) return CONFIG_POR_DEFECTO;
  const r = configSchema.safeParse(fila.config);
  return r.success ? r.data : CONFIG_POR_DEFECTO;
}

export async function guardarConfig(organizationId: string, c: ConfigCotizaciones): Promise<ConfigCotizaciones> {
  await asegurarTablas();
  await getDb()
    .insert(cotizacionConfig)
    .values({ organizationId, config: c, updatedAt: new Date() })
    .onConflictDoUpdate({ target: cotizacionConfig.organizationId, set: { config: c, updatedAt: new Date() } });
  return c;
}

export async function leerLogo(organizationId: string): Promise<{ data: Buffer; mime: string } | null> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select({ b: cotizacionConfig.logoBase64, m: cotizacionConfig.logoMime })
    .from(cotizacionConfig)
    .where(scoped(cotizacionConfig.organizationId, organizationId))
    .limit(1);
  if (!fila?.b || !fila.m) return null;
  return { data: Buffer.from(fila.b, "base64"), mime: fila.m };
}

export async function guardarLogo(organizationId: string, logo: { data: Buffer; mime: string } | null): Promise<void> {
  await asegurarTablas();
  const set = { logoBase64: logo ? logo.data.toString("base64") : null, logoMime: logo?.mime ?? null, updatedAt: new Date() };
  await getDb()
    .insert(cotizacionConfig)
    .values({ organizationId, config: await leerConfig(organizationId), ...set })
    .onConflictDoUpdate({ target: cotizacionConfig.organizationId, set });
}

// ------------------------------------------------------------ cotizaciones

type Fila = typeof cotizacion.$inferSelect;

export function aDto(f: Fila, ahora = new Date()): CotizacionDto {
  return {
    id: f.id,
    folio: folioDe(f.numero),
    conversationId: f.conversationId,
    contactoNombre: f.contactoNombre,
    estado: estadoVisible(f.estado, f.venceEn, ahora),
    partidas: f.partidas,
    descuentoPct: Number(f.descuentoPct),
    notas: f.notas,
    totales: f.totales,
    moneda: f.condiciones.moneda ?? "MXN",
    venceEn: f.venceEn?.toISOString() ?? null,
    enviadaEn: f.enviadaEn?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    seguimientoPausado: Boolean(f.seguimientoPausado),
    senal: f.senalTexto && f.senalEn ? { texto: f.senalTexto, en: f.senalEn.toISOString() } : null,
    deAgente: f.creadaPor === CREADA_POR_AGENTE,
    automatica: f.enviadaPor === CREADA_POR_AGENTE,
    reemplazaA: f.reemplazaA ?? null,
  };
}

export async function leerCotizacion(organizationId: string, id: string): Promise<Fila | null> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(cotizacion)
    .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, id)))
    .limit(1);
  return f ?? null;
}

export async function listarCotizaciones(
  organizationId: string,
  filtro: { conversationId?: string; limite?: number } = {}
): Promise<CotizacionDto[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select()
    .from(cotizacion)
    .where(
      scoped(
        cotizacion.organizationId,
        organizationId,
        filtro.conversationId ? eq(cotizacion.conversationId, filtro.conversationId) : undefined
      )
    )
    .orderBy(desc(cotizacion.createdAt))
    .limit(Math.min(filtro.limite ?? 50, 200));
  const ahora = new Date();
  return filas.map((f) => aDto(f, ahora));
}

/** Datos del contacto de una conversación de esta organización (o null si no existe). */
export async function contactoDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<{
  contactId: string;
  nombre: string;
  windowOpen: boolean | null;
  isTest: boolean;
  ficha: Record<string, unknown> | null;
} | null> {
  const [f] = await getDb()
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!f) return null;
  return {
    contactId: f.contact.id,
    nombre: f.contact.name,
    windowOpen: null,
    isTest: f.conversation.isTest,
    ficha: f.contact.ficha ?? null,
  };
}

function condicionesDe(c: ConfigCotizaciones): Omit<ConfigCotizaciones, "productos"> {
  const { productos: _productos, ...resto } = c;
  void _productos;
  return resto;
}

/**
 * Guarda un borrador nuevo, o reescribe uno existente si `id` es de un
 * borrador (una enviada ya no se toca: se hace otra).
 */
export async function guardarBorrador(input: {
  organizationId: string;
  id?: string | null;
  datos: CotizacionInput;
  creadaPor: string | null;
}): Promise<{ ok: true; fila: Fila } | { ok: false; codigo: string; detalle: string }> {
  await asegurarTablas();
  const contacto = await contactoDeConversacion(input.organizationId, input.datos.conversationId);
  if (!contacto) return { ok: false, codigo: "no_existe", detalle: "Conversación no encontrada" };
  const config = await leerConfig(input.organizationId);
  const totales = calcularTotales(input.datos.partidas, {
    descuentoPct: input.datos.descuentoPct,
    ivaPct: config.ivaPct,
    preciosConIva: config.preciosConIva,
    anticipoPct: config.anticipoPct,
  });
  const valores = {
    conversationId: input.datos.conversationId,
    contactId: contacto.contactId,
    contactoNombre: input.datos.cliente || contacto.nombre,
    partidas: input.datos.partidas,
    descuentoPct: input.datos.descuentoPct,
    notas: input.datos.notas,
    totales,
    condiciones: condicionesDe(config),
    reemplazaA: input.datos.reemplazaA ?? null,
    updatedAt: new Date(),
  };
  const db = getDb();

  if (input.id) {
    const previa = await leerCotizacion(input.organizationId, input.id);
    if (!previa) return { ok: false, codigo: "no_existe", detalle: "Cotización no encontrada" };
    if (previa.estado !== "borrador") {
      return { ok: false, codigo: "ya_enviada", detalle: "Esa cotización ya se envió: haz una nueva" };
    }
    const [f] = await db
      .update(cotizacion)
      .set(valores)
      .where(scoped(cotizacion.organizationId, input.organizationId, eq(cotizacion.id, input.id)))
      .returning();
    return { ok: true, fila: f! };
  }

  // Folio consecutivo: si otro lo tomó al mismo tiempo, el UNIQUE choca y se reintenta.
  for (let intento = 0; intento < 5; intento++) {
    const [max] = await db
      .select({ n: sql<number>`coalesce(max(${cotizacion.numero}), 0)` })
      .from(cotizacion)
      .where(eq(cotizacion.organizationId, input.organizationId));
    const numero = Number(max?.n ?? 0) + 1;
    try {
      const [f] = await db
        .insert(cotizacion)
        .values({
          id: `cot_${nano()}`,
          organizationId: input.organizationId,
          numero,
          estado: "borrador",
          creadaPor: input.creadaPor,
          ...valores,
        })
        .returning();
      return { ok: true, fila: f! };
    } catch (err) {
      if (!String((err as { code?: string }).code ?? err).includes("23505")) throw err;
    }
  }
  return { ok: false, codigo: "ocupado", detalle: "No se pudo apartar el folio; intenta de nuevo" };
}

export async function marcarEnviada(
  organizationId: string,
  id: string,
  datos: { messageId: string | null; vigenciaDias: number; enviadaPor?: string | null }
): Promise<void> {
  const ahora = new Date();
  await getDb()
    .update(cotizacion)
    .set({
      estado: "enviada",
      enviadaEn: ahora,
      venceEn: new Date(ahora.getTime() + datos.vigenciaDias * 24 * 60 * 60 * 1000),
      messageId: datos.messageId,
      enviadaPor: datos.enviadaPor ?? null,
      updatedAt: ahora,
    })
    .where(scoped(cotizacion.organizationId, organizationId, eq(cotizacion.id, id)));
}

/**
 * Módulo de la agencia — una cotización enviada que se corrigió con otra:
 * queda «reemplazada» y sin seguimiento (ya no se le recuerda al cliente).
 */
export async function marcarReemplazada(organizationId: string, id: string): Promise<void> {
  await getDb()
    .update(cotizacion)
    .set({ estado: "reemplazada", seguimientoPausado: true, updatedAt: new Date() })
    .where(
      scoped(
        cotizacion.organizationId,
        organizationId,
        and(eq(cotizacion.id, id), sql`${cotizacion.estado} IN ('enviada', 'aceptada', 'rechazada')`)
      )
    );
}

/** El borrador de una conversación, si hay (la bandeja retoma uno a la vez). */
export async function borradorDeConversacion(organizationId: string, conversationId: string): Promise<Fila | null> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(cotizacion)
    .where(
      scoped(
        cotizacion.organizationId,
        organizationId,
        and(eq(cotizacion.conversationId, conversationId), eq(cotizacion.estado, "borrador"))
      )
    )
    .orderBy(desc(cotizacion.createdAt))
    .limit(1);
  return f ?? null;
}

/** Cuántas cotizaciones armó el agente en esta conversación desde `desde`. */
export async function cotizacionesDelAgenteDesde(
  organizationId: string,
  conversationId: string,
  desde: Date
): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(cotizacion)
    .where(
      scoped(
        cotizacion.organizationId,
        organizationId,
        and(
          eq(cotizacion.conversationId, conversationId),
          eq(cotizacion.creadaPor, CREADA_POR_AGENTE),
          gte(cotizacion.createdAt, desde)
        )
      )
    );
  return Number(r?.n ?? 0);
}

export async function cambiarEstado(
  organizationId: string,
  id: string,
  estado: Exclude<EstadoCotizacion, "borrador" | "vencida">
): Promise<Fila | null> {
  const [f] = await getDb()
    .update(cotizacion)
    .set({ estado, updatedAt: new Date() })
    .where(
      scoped(
        cotizacion.organizationId,
        organizationId,
        and(eq(cotizacion.id, id), sql`${cotizacion.estado} <> 'borrador'`)
      )
    )
    .returning();
  return f ?? null;
}

export async function borrarBorrador(organizationId: string, id: string): Promise<boolean> {
  const filas = await getDb()
    .delete(cotizacion)
    .where(
      scoped(cotizacion.organizationId, organizationId, and(eq(cotizacion.id, id), eq(cotizacion.estado, "borrador")))
    )
    .returning({ id: cotizacion.id });
  return filas.length > 0;
}
