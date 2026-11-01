import { randomUUID } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  type ConfigAprende,
  type SugerenciaDto,
  type SugerenciaIa,
} from "@/lib/aprende-traspasos";

/**
 * Módulo de la agencia — lo que guarda «Nea aprende de sus traspasos».
 *
 * Como los demás módulos de la agencia, sus tablas NO van en `drizzle/`: se
 * crean solas, idempotentes, la primera vez. Un traspaso por cada vez que el
 * agente pasa una conversación (abierto → analizado / vencido / error) y sus
 * sugerencias (pendiente → aprobada / descartada).
 */

export const aprendeConfig = pgTable("agencia_aprende_config", {
  organizationId: text("organization_id").primaryKey(),
  activo: boolean("activo").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EstadoTraspaso = "abierto" | "analizado" | "vencido" | "error";

export const aprendeTraspaso = pgTable("agencia_aprende_traspaso", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  motivo: text("motivo").notNull(),
  desde: timestamp("desde").notNull().defaultNow(),
  estado: text("estado").$type<EstadoTraspaso>().notNull().default("abierto"),
  detalle: text("detalle"),
  analizadoEn: timestamp("analizado_en"),
});

export type EstadoSugerencia = SugerenciaDto["estado"];

export const aprendeSugerencia = pgTable("agencia_aprende_sugerencia", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  traspasoId: text("traspaso_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  pregunta: text("pregunta").notNull(),
  respuesta: text("respuesta").notNull(),
  porque: text("porque").notNull().default(""),
  estado: text("estado").$type<EstadoSugerencia>().notNull().default("pendiente"),
  kbEntryId: text("kb_entry_id"),
  creadoEn: timestamp("creado_en").notNull().defaultNow(),
  resueltoEn: timestamp("resuelto_en"),
});

function nuevoId(prefijo: string): string {
  return `${prefijo}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

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
    CREATE TABLE IF NOT EXISTS agencia_aprende_config (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      activo boolean NOT NULL DEFAULT true,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_aprende_traspaso (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      motivo text NOT NULL,
      desde timestamp NOT NULL DEFAULT now(),
      estado text NOT NULL DEFAULT 'abierto',
      detalle text,
      analizado_en timestamp
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agencia_aprende_traspaso_abierto_idx
      ON agencia_aprende_traspaso (estado, organization_id)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_aprende_sugerencia (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      traspaso_id text NOT NULL REFERENCES agencia_aprende_traspaso(id) ON DELETE CASCADE,
      conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      pregunta text NOT NULL,
      respuesta text NOT NULL,
      porque text NOT NULL DEFAULT '',
      estado text NOT NULL DEFAULT 'pendiente',
      kb_entry_id text,
      creado_en timestamp NOT NULL DEFAULT now(),
      resuelto_en timestamp
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS agencia_aprende_sugerencia_org_idx
      ON agencia_aprende_sugerencia (organization_id, estado)`);
}

export async function leerConfig(organizationId: string): Promise<ConfigAprende> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(aprendeConfig)
    .where(eq(aprendeConfig.organizationId, organizationId))
    .limit(1);
  if (!f) return CONFIG_POR_DEFECTO;
  const r = configSchema.safeParse({ activo: f.activo });
  return r.success ? r.data : CONFIG_POR_DEFECTO;
}

export async function guardarConfig(organizationId: string, c: ConfigAprende): Promise<ConfigAprende> {
  await asegurarTablas();
  await getDb()
    .insert(aprendeConfig)
    .values({ organizationId, activo: c.activo })
    .onConflictDoUpdate({ target: aprendeConfig.organizationId, set: { activo: c.activo, updatedAt: new Date() } });
  return leerConfig(organizationId);
}

/** Anota un traspaso nuevo. Si esa conversación ya tiene uno abierto, no hace otro. */
export async function abrirTraspaso(organizationId: string, conversationId: string, motivo: string): Promise<boolean> {
  await asegurarTablas();
  const db = getDb();
  const [abierto] = await db
    .select({ id: aprendeTraspaso.id })
    .from(aprendeTraspaso)
    .where(
      scoped(
        aprendeTraspaso.organizationId,
        organizationId,
        and(eq(aprendeTraspaso.conversationId, conversationId), eq(aprendeTraspaso.estado, "abierto"))
      )
    )
    .limit(1);
  if (abierto) return false;
  await db.insert(aprendeTraspaso).values({ id: nuevoId("apt"), organizationId, conversationId, motivo });
  return true;
}

export async function traspasosAbiertos(organizationId?: string) {
  await asegurarTablas();
  const filtro = organizationId
    ? and(eq(aprendeTraspaso.estado, "abierto"), eq(aprendeTraspaso.organizationId, organizationId))
    : eq(aprendeTraspaso.estado, "abierto");
  return getDb().select().from(aprendeTraspaso).where(filtro).orderBy(aprendeTraspaso.desde).limit(200);
}

export async function cerrarTraspaso(id: string, estado: Exclude<EstadoTraspaso, "abierto">, detalle: string | null) {
  await getDb()
    .update(aprendeTraspaso)
    .set({ estado, detalle, analizadoEn: new Date() })
    .where(and(eq(aprendeTraspaso.id, id), eq(aprendeTraspaso.estado, "abierto")));
}

export async function guardarSugerencias(
  t: { id: string; organizationId: string; conversationId: string },
  sugerencias: SugerenciaIa[]
): Promise<void> {
  if (!sugerencias.length) return;
  await getDb()
    .insert(aprendeSugerencia)
    .values(
      sugerencias.map((s) => ({
        id: nuevoId("aps"),
        organizationId: t.organizationId,
        traspasoId: t.id,
        conversationId: t.conversationId,
        pregunta: s.pregunta,
        respuesta: s.respuesta,
        porque: s.porque,
      }))
    );
}

/** Preguntas pendientes, para no proponer dos veces lo mismo mientras el dueño no las revisa. */
export async function preguntasPendientes(organizationId: string): Promise<string[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select({ pregunta: aprendeSugerencia.pregunta })
    .from(aprendeSugerencia)
    .where(scoped(aprendeSugerencia.organizationId, organizationId, eq(aprendeSugerencia.estado, "pendiente")));
  return filas.map((f) => f.pregunta);
}

export async function listarPendientes(organizationId: string): Promise<SugerenciaDto[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select({ s: aprendeSugerencia, nombre: schema.contact.name })
    .from(aprendeSugerencia)
    .leftJoin(schema.conversation, eq(schema.conversation.id, aprendeSugerencia.conversationId))
    .leftJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(aprendeSugerencia.organizationId, organizationId, eq(aprendeSugerencia.estado, "pendiente")))
    .orderBy(desc(aprendeSugerencia.creadoEn))
    .limit(50);
  return filas.map(({ s, nombre }) => ({
    id: s.id,
    conversationId: s.conversationId,
    nombreContacto: nombre ?? "",
    pregunta: s.pregunta,
    respuesta: s.respuesta,
    porque: s.porque,
    estado: s.estado,
    creadoEn: s.creadoEn.toISOString(),
  }));
}

export async function contar(organizationId: string) {
  await asegurarTablas();
  const db = getDb();
  const porEstado = await db
    .select({ estado: aprendeSugerencia.estado, n: count() })
    .from(aprendeSugerencia)
    .where(eq(aprendeSugerencia.organizationId, organizationId))
    .groupBy(aprendeSugerencia.estado);
  const [espera] = await db
    .select({ n: count() })
    .from(aprendeTraspaso)
    .where(and(eq(aprendeTraspaso.organizationId, organizationId), eq(aprendeTraspaso.estado, "abierto")));
  const de = (e: string) => Number(porEstado.find((f) => f.estado === e)?.n ?? 0);
  return { enEspera: Number(espera?.n ?? 0), aprobadas: de("aprobada"), descartadas: de("descartada") };
}

/**
 * Aprueba una sugerencia: crea la P/R en el conocimiento con el texto final
 * (el dueño pudo editarlo) y la marca. Solo si sigue pendiente: dos clics no
 * crean dos entradas.
 */
export async function aprobar(
  organizationId: string,
  id: string,
  texto: { pregunta: string; respuesta: string }
): Promise<"ok" | "no_existe"> {
  await asegurarTablas();
  return getDb().transaction(async (tx) => {
    const [marcada] = await tx
      .update(aprendeSugerencia)
      .set({ estado: "aprobada", pregunta: texto.pregunta, respuesta: texto.respuesta, resueltoEn: new Date() })
      .where(
        scoped(
          aprendeSugerencia.organizationId,
          organizationId,
          and(eq(aprendeSugerencia.id, id), eq(aprendeSugerencia.estado, "pendiente"))
        )
      )
      .returning({ id: aprendeSugerencia.id });
    if (!marcada) return "no_existe";
    const kbId = newId("kbEntry");
    await tx.insert(schema.kbEntry).values({
      id: kbId,
      organizationId,
      kind: "qa",
      question: texto.pregunta,
      answer: texto.respuesta,
    });
    await tx.update(aprendeSugerencia).set({ kbEntryId: kbId }).where(eq(aprendeSugerencia.id, id));
    return "ok";
  });
}

export async function descartar(organizationId: string, id: string): Promise<"ok" | "no_existe"> {
  await asegurarTablas();
  const [f] = await getDb()
    .update(aprendeSugerencia)
    .set({ estado: "descartada", resueltoEn: new Date() })
    .where(
      scoped(
        aprendeSugerencia.organizationId,
        organizationId,
        and(eq(aprendeSugerencia.id, id), eq(aprendeSugerencia.estado, "pendiente"))
      )
    )
    .returning({ id: aprendeSugerencia.id });
  return f ? "ok" : "no_existe";
}
