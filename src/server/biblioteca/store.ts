import { and, desc, eq, gte, sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { borrarMedia, guardarMedia, leerMedia } from "@/lib/storage/medios";
import { tipoDe, type ArchivoDto } from "@/lib/biblioteca";

/**
 * Módulo de la agencia — lo que guarda la Biblioteca.
 *
 * Como los demás módulos, sus tablas NO van en `drizzle/`: se crean solas,
 * idempotentes, la primera vez. El archivo vive donde viven los adjuntos del
 * CRM (el volumen `/data/media` del servidor), con su id como nombre.
 */

export const archivo = pgTable("agencia_biblioteca", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  titulo: text("titulo").notNull(),
  cuando: text("cuando").notNull().default(""),
  mime: text("mime").notNull(),
  nombreArchivo: text("nombre_archivo").notNull(),
  tamano: integer("tamano").notNull(),
  activo: boolean("activo").notNull().default(true),
  creadoPor: text("creado_por"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const envio = pgTable("agencia_biblioteca_envio", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  archivoId: text("archivo_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FilaArchivo = typeof archivo.$inferSelect;

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
    CREATE TABLE IF NOT EXISTS agencia_biblioteca (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      titulo text NOT NULL,
      cuando text NOT NULL DEFAULT '',
      mime text NOT NULL,
      nombre_archivo text NOT NULL,
      tamano integer NOT NULL,
      activo boolean NOT NULL DEFAULT true,
      creado_por text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_biblioteca_org_idx ON agencia_biblioteca (organization_id, created_at)`
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_biblioteca_envio (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      archivo_id text NOT NULL REFERENCES agencia_biblioteca(id) ON DELETE CASCADE,
      conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      message_id text,
      created_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_biblioteca_envio_conv_idx ON agencia_biblioteca_envio (organization_id, conversation_id, created_at)`
  );
}

export function aDto(f: FilaArchivo, envios = 0): ArchivoDto {
  return {
    id: f.id,
    titulo: f.titulo,
    cuando: f.cuando,
    tipo: tipoDe(f.mime),
    mime: f.mime,
    nombreArchivo: f.nombreArchivo,
    tamano: f.tamano,
    activo: f.activo,
    envios,
    creadoEn: f.createdAt.toISOString(),
  };
}

/** Todos los archivos del negocio, el más nuevo primero, con cuántas veces se mandó cada uno. */
export async function listarArchivos(organizationId: string): Promise<ArchivoDto[]> {
  await asegurarTablas();
  const db = getDb();
  const [filas, conteos] = await Promise.all([
    db
      .select()
      .from(archivo)
      .where(scoped(archivo.organizationId, organizationId))
      .orderBy(desc(archivo.createdAt)),
    db
      .select({ archivoId: envio.archivoId, n: sql<number>`count(*)::int` })
      .from(envio)
      .where(scoped(envio.organizationId, organizationId))
      .groupBy(envio.archivoId),
  ]);
  const porArchivo = new Map(conteos.map((c) => [c.archivoId, c.n]));
  return filas.map((f) => aDto(f, porArchivo.get(f.id) ?? 0));
}

export async function contarArchivos(organizationId: string): Promise<number> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(archivo)
    .where(scoped(archivo.organizationId, organizationId));
  return fila?.n ?? 0;
}

export async function leerArchivo(organizationId: string, id: string): Promise<FilaArchivo | null> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(archivo)
    .where(and(scoped(archivo.organizationId, organizationId), eq(archivo.id, id)))
    .limit(1);
  return fila ?? null;
}

/** Guarda el binario y su fila. Si la fila falla, el binario se borra. */
export async function crearArchivo(input: {
  organizationId: string;
  titulo: string;
  cuando: string;
  mime: string;
  nombreArchivo: string;
  data: Buffer;
  creadoPor: string | null;
}): Promise<FilaArchivo> {
  await asegurarTablas();
  const id = `bib_${nano()}`;
  await guardarMedia(input.organizationId, id, input.data, input.mime);
  try {
    const [fila] = await getDb()
      .insert(archivo)
      .values({
        id,
        organizationId: input.organizationId,
        titulo: input.titulo,
        cuando: input.cuando,
        mime: input.mime,
        nombreArchivo: input.nombreArchivo.slice(0, 200) || "archivo",
        tamano: input.data.byteLength,
        creadoPor: input.creadoPor,
      })
      .returning();
    return fila!;
  } catch (err) {
    await borrarMedia(input.organizationId, id);
    throw err;
  }
}

export async function cambiarArchivo(
  organizationId: string,
  id: string,
  cambios: { titulo?: string; cuando?: string; activo?: boolean }
): Promise<FilaArchivo | null> {
  await asegurarTablas();
  const [fila] = await getDb()
    .update(archivo)
    .set({ ...cambios, updatedAt: new Date() })
    .where(and(scoped(archivo.organizationId, organizationId), eq(archivo.id, id)))
    .returning();
  return fila ?? null;
}

/** Borra la fila (y sus envíos, en cascada) y luego el binario. */
export async function borrarArchivo(organizationId: string, id: string): Promise<boolean> {
  await asegurarTablas();
  const borradas = await getDb()
    .delete(archivo)
    .where(and(scoped(archivo.organizationId, organizationId), eq(archivo.id, id)))
    .returning({ id: archivo.id });
  if (borradas.length === 0) return false;
  await borrarMedia(organizationId, id);
  return true;
}

export function leerBinario(organizationId: string, id: string): Promise<Buffer> {
  return leerMedia(organizationId, id);
}

export async function registrarEnvio(input: {
  organizationId: string;
  archivoId: string;
  conversationId: string;
  messageId: string | null;
}): Promise<void> {
  await asegurarTablas();
  await getDb()
    .insert(envio)
    .values({ id: `bie_${nano()}`, ...input });
}

/** Qué archivos se le mandaron a esta conversación desde `desde`. */
export async function enviadosDesde(
  organizationId: string,
  conversationId: string,
  desde: Date
): Promise<string[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select({ archivoId: envio.archivoId })
    .from(envio)
    .where(
      and(
        scoped(envio.organizationId, organizationId),
        eq(envio.conversationId, conversationId),
        gte(envio.createdAt, desde)
      )
    );
  return filas.map((f) => f.archivoId);
}

/**
 * El `/reset` de la línea de pruebas: la conversación vuelve a empezar, así
 * que el agente no debe creer que ya mandó nada (decía «ahí te la mandé» sin
 * mandarla). Los mensajes del hilo se quedan: solo se borra la cuenta.
 */
export async function olvidarEnvios(organizationId: string, conversationId: string): Promise<void> {
  await asegurarTablas();
  await getDb()
    .delete(envio)
    .where(and(scoped(envio.organizationId, organizationId), eq(envio.conversationId, conversationId)));
}

/** Qué archivos se le han mandado alguna vez a esta conversación. */
export async function enviadosAConversacion(organizationId: string, conversationId: string): Promise<Set<string>> {
  return new Set(await enviadosDesde(organizationId, conversationId, new Date(0)));
}
