import { and, count, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { boolean, jsonb, numeric, pgTable, primaryKey, text, timestamp, integer } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { dayIsoInTz } from "@/lib/time/slots";
import {
  CODIGOS_FALLO_PAGO,
  CONFIG_POR_DEFECTO,
  configSchema,
  normalizarCategoria,
  type ConfigContador,
  type CostoOficial,
  type FilaMensaje,
  type Mes,
  type Origen,
} from "@/lib/contador-mensajes";
import type { WebhookStatus } from "@/server/inbox/webhook";

/**
 * Módulo de la agencia — lo que guarda el contador de mensajes.
 *
 * Como los otros módulos de la agencia, sus tablas NO van en `drizzle/` (las
 * migraciones de Vocero raíz se aplican por fecha y una propia en medio podría
 * saltarse una futura de Kevin): se crean solas, idempotentes, la primera vez.
 *
 * - `agencia_cobro_mensaje`: lo que Meta dijo del cobro de cada mensaje en su
 *   aviso de entrega (categoría y si entró en las gratis), y los que fallaron
 *   por un problema de pago. Una fila por mensaje de WhatsApp.
 * - `agencia_contador_config`: aviso, teléfono del dueño, tarifas, último aviso.
 * - `agencia_costo_oficial`: el reporte de costos de Meta del mes, en caché.
 */

export const cobroMensaje = pgTable("agencia_cobro_mensaje", {
  waMessageId: text("wa_message_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  categoria: text("categoria"),
  tipo: text("tipo"),
  cobrable: boolean("cobrable"),
  falloPago: boolean("fallo_pago").notNull().default(false),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
});

export const contadorConfig = pgTable("agencia_contador_config", {
  organizationId: text("organization_id").primaryKey(),
  alertaPct: integer("alerta_pct").notNull(),
  telefonoDueno: text("telefono_dueno"),
  plantillaId: text("plantilla_id"),
  tarifas: jsonb("tarifas").$type<ConfigContador["tarifas"]>().notNull(),
  ultimoAviso: text("ultimo_aviso"),
  ultimoAvisoDetalle: text("ultimo_aviso_detalle"),
  ultimoAvisoEn: timestamp("ultimo_aviso_en"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const costoOficial = pgTable(
  "agencia_costo_oficial",
  {
    organizationId: text("organization_id").notNull(),
    mes: text("mes").notNull(),
    moneda: text("moneda"),
    costo: numeric("costo", { precision: 12, scale: 4 }).notNull(),
    respuestas: integer("respuestas").notNull(),
    plantillas: integer("plantillas").notNull(),
    actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.mes] })]
);

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
    CREATE TABLE IF NOT EXISTS agencia_cobro_mensaje (
      wa_message_id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      categoria text,
      tipo text,
      cobrable boolean,
      fallo_pago boolean NOT NULL DEFAULT false,
      creado_en timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_cobro_mensaje_org_idx ON agencia_cobro_mensaje (organization_id, creado_en)`
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_contador_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      alerta_pct integer NOT NULL,
      telefono_dueno text,
      plantilla_id text,
      tarifas jsonb NOT NULL,
      ultimo_aviso text,
      ultimo_aviso_detalle text,
      ultimo_aviso_en timestamp,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_costo_oficial (
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      mes text NOT NULL,
      moneda text,
      costo numeric(12, 4) NOT NULL,
      respuestas integer NOT NULL,
      plantillas integer NOT NULL,
      actualizado_en timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, mes)
    )`);
}

export { mesEnZona, type Mes } from "@/lib/contador-mensajes";

/* ─────────────── El aviso de entrega de Meta ─────────────── */

/** Lo que Meta agrega al aviso de estado y el tipo base del CRM no declara. */
type StatusConCobro = WebhookStatus & {
  pricing?: { billable?: boolean; category?: string; type?: string; pricing_model?: string };
};

/**
 * Guarda lo que Meta dijo del cobro de un mensaje. Se llama por cada aviso de
 * estado; jamás lanza (un fallo aquí no puede tumbar el webhook).
 */
export async function registrarAvisoDeMeta(organizationId: string, status: WebhookStatus): Promise<void> {
  try {
    const s = status as StatusConCobro;
    const falloPago =
      s.status === "failed" && (s.errors ?? []).some((e) => CODIGOS_FALLO_PAGO.has(Number(e.code)));
    const categoria = normalizarCategoria(s.pricing?.category);
    if (!categoria && !falloPago) return;
    await asegurarTablas();
    const valores = {
      organizationId,
      categoria,
      tipo: s.pricing?.type?.toLowerCase() ?? null,
      cobrable: typeof s.pricing?.billable === "boolean" ? s.pricing.billable : null,
      falloPago,
    };
    await getDb()
      .insert(cobroMensaje)
      .values({ waMessageId: s.id, ...valores })
      .onConflictDoUpdate({
        target: cobroMensaje.waMessageId,
        // Un aviso posterior sin precio (leído) no borra lo que ya se sabía.
        set: {
          categoria: sql`coalesce(excluded.categoria, ${cobroMensaje.categoria})`,
          tipo: sql`coalesce(excluded.tipo, ${cobroMensaje.tipo})`,
          cobrable: sql`coalesce(excluded.cobrable, ${cobroMensaje.cobrable})`,
          falloPago: sql`${cobroMensaje.falloPago} OR excluded.fallo_pago`,
        },
      });
  } catch (err) {
    console.error("[contador] no se pudo guardar el cobro del aviso de Meta:", err);
  }
}

/* ─────────────── Lo que salió este mes ─────────────── */

/**
 * Los mensajes ENTREGADOS del mes por WhatsApp (Meta solo cobra lo entregado),
 * sin conversaciones de prueba ni lo que el dueño mandó desde la app del
 * teléfono (eso no pasa por la API de la nube).
 */
export async function filasDelMes(organizationId: string, mes: Mes, tz: string): Promise<FilaMensaje[]> {
  await asegurarTablas();
  const m = schema.message;
  const filas = await getDb()
    .select({ creado: m.createdAt, origen: m.origin, categoria: cobroMensaje.categoria, tipo: cobroMensaje.tipo })
    .from(m)
    .innerJoin(schema.conversation, eq(m.conversationId, schema.conversation.id))
    .leftJoin(cobroMensaje, eq(cobroMensaje.waMessageId, m.waMessageId))
    .where(
      scoped(
        m.organizationId,
        organizationId,
        and(
          eq(m.direction, "out"),
          isNotNull(m.waMessageId),
          inArray(m.status, ["delivered", "read"]),
          ne(m.origin, "manual"),
          eq(schema.conversation.isTest, false),
          eq(schema.conversation.channel, "whatsapp"),
          gte(m.createdAt, mes.inicio),
          lt(m.createdAt, mes.fin)
        )
      )
    );
  return filas.map((f) => ({
    dia: Number(dayIsoInTz(f.creado, tz).slice(8, 10)),
    origen: f.origen as Origen,
    categoria: normalizarCategoria(f.categoria),
    tipo: f.tipo,
  }));
}

/** Mensajes recibidos de clientes en el mes (gratis, solo para mostrar). */
export async function recibidosDelMes(organizationId: string, mes: Mes): Promise<number> {
  const m = schema.message;
  const [r] = await getDb()
    .select({ n: count() })
    .from(m)
    .innerJoin(schema.conversation, eq(m.conversationId, schema.conversation.id))
    .where(
      scoped(
        m.organizationId,
        organizationId,
        and(
          eq(m.direction, "in"),
          eq(schema.conversation.isTest, false),
          eq(schema.conversation.channel, "whatsapp"),
          gte(m.createdAt, mes.inicio),
          lt(m.createdAt, mes.fin)
        )
      )
    );
  return Number(r?.n ?? 0);
}

export async function fallosDePago(organizationId: string, mes: Mes): Promise<number> {
  await asegurarTablas();
  const [r] = await getDb()
    .select({ n: count() })
    .from(cobroMensaje)
    .where(
      scoped(
        cobroMensaje.organizationId,
        organizationId,
        and(eq(cobroMensaje.falloPago, true), gte(cobroMensaje.creadoEn, mes.inicio), lt(cobroMensaje.creadoEn, mes.fin))
      )
    );
  return Number(r?.n ?? 0);
}

/* ─────────────── Ajustes ─────────────── */

export type ConfigGuardada = ConfigContador & {
  ultimoAviso: string | null;
  ultimoAvisoDetalle: string | null;
  ultimoAvisoEn: Date | null;
};

export async function leerConfig(organizationId: string): Promise<ConfigGuardada> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(contadorConfig)
    .where(scoped(contadorConfig.organizationId, organizationId))
    .limit(1);
  const base = { ultimoAviso: null, ultimoAvisoDetalle: null, ultimoAvisoEn: null };
  if (!f) return { ...CONFIG_POR_DEFECTO, ...base };
  const r = configSchema.safeParse({
    alertaPct: f.alertaPct,
    telefonoDueno: f.telefonoDueno,
    plantillaId: f.plantillaId,
    tarifas: f.tarifas,
  });
  return {
    ...(r.success ? r.data : CONFIG_POR_DEFECTO),
    ultimoAviso: f.ultimoAviso,
    ultimoAvisoDetalle: f.ultimoAvisoDetalle,
    ultimoAvisoEn: f.ultimoAvisoEn,
  };
}

export async function guardarConfig(organizationId: string, c: ConfigContador): Promise<ConfigContador> {
  await asegurarTablas();
  const valores = {
    alertaPct: c.alertaPct,
    telefonoDueno: c.telefonoDueno,
    plantillaId: c.plantillaId,
    tarifas: c.tarifas,
  };
  await getDb()
    .insert(contadorConfig)
    .values({ organizationId, ...valores, updatedAt: new Date() })
    .onConflictDoUpdate({ target: contadorConfig.organizationId, set: { ...valores, updatedAt: new Date() } });
  return c;
}

export async function anotarAviso(organizationId: string, clave: string, detalle: string): Promise<void> {
  await asegurarTablas();
  const actual = await leerConfig(organizationId);
  const ahora = new Date();
  await getDb()
    .insert(contadorConfig)
    .values({
      organizationId,
      alertaPct: actual.alertaPct,
      telefonoDueno: actual.telefonoDueno,
      plantillaId: actual.plantillaId,
      tarifas: actual.tarifas,
      ultimoAviso: clave,
      ultimoAvisoDetalle: detalle.slice(0, 300),
      ultimoAvisoEn: ahora,
    })
    .onConflictDoUpdate({
      target: contadorConfig.organizationId,
      set: { ultimoAviso: clave, ultimoAvisoDetalle: detalle.slice(0, 300), ultimoAvisoEn: ahora },
    });
}

/* ─────────────── El reporte oficial de Meta, en caché ─────────────── */

export async function leerOficial(organizationId: string, mes: string): Promise<CostoOficial | null> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(costoOficial)
    .where(scoped(costoOficial.organizationId, organizationId, eq(costoOficial.mes, mes)))
    .limit(1);
  if (!f) return null;
  return {
    mes: f.mes,
    moneda: f.moneda,
    costo: Number(f.costo),
    respuestas: f.respuestas,
    plantillas: f.plantillas,
    actualizadoEn: f.actualizadoEn.toISOString(),
  };
}

export async function guardarOficial(organizationId: string, o: Omit<CostoOficial, "actualizadoEn">): Promise<void> {
  await asegurarTablas();
  const valores = {
    moneda: o.moneda,
    costo: String(o.costo),
    respuestas: o.respuestas,
    plantillas: o.plantillas,
    actualizadoEn: new Date(),
  };
  await getDb()
    .insert(costoOficial)
    .values({ organizationId, mes: o.mes, ...valores })
    .onConflictDoUpdate({ target: [costoOficial.organizationId, costoOficial.mes], set: valores });
}
