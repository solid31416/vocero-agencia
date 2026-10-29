import { asc, eq, sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CLAVES_TIPO,
  MAX_CLIENTES,
  PREFIJO_CLIENTE,
  type ClienteDto,
  type ClienteInput,
  type NegocioDto,
  type TipoCliente,
} from "@/lib/lab-a-la-medida";

/**
 * Módulo de la agencia — dónde viven los clientes de prueba de cada negocio.
 *
 * Las tablas NO van en `schema.ts` ni en `drizzle/`: las migraciones de Vocero
 * raíz se aplican por fecha, y una migración propia en medio podría hacer que
 * una futura de Kevin se salte al actualizar. Por eso se crean solas, la
 * primera vez que se usan (`CREATE TABLE IF NOT EXISTS`, idempotente), y solo
 * con la bandera encendida. Borrar la organización las borra en cascada.
 */

export const labPersona = pgTable("agencia_lab_persona", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  tipo: text("tipo").notNull(),
  nombre: text("nombre").notNull(),
  guion: jsonb("guion").$type<string[]>().notNull(),
  activo: boolean("activo").notNull().default(true),
  propio: boolean("propio").notNull().default(false),
  orden: integer("orden").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const labNegocio = pgTable("agencia_lab_negocio", {
  organizationId: text("organization_id").primaryKey(),
  tipoNegocio: text("tipo_negocio").notNull().default(""),
  quienes: text("quienes").notNull().default(""),
  usarPropios: boolean("usar_propios").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);
const nuevoId = () => `${PREFIJO_CLIENTE}${nano()}`;

export class ClienteLabError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

let listas: Promise<void> | null = null;

/** Crea las tablas si faltan. Una vez por proceso; si falla, se reintenta luego. */
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
    CREATE TABLE IF NOT EXISTS agencia_lab_persona (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      tipo text NOT NULL,
      nombre text NOT NULL,
      guion jsonb NOT NULL,
      activo boolean NOT NULL DEFAULT true,
      propio boolean NOT NULL DEFAULT false,
      orden integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS agencia_lab_persona_org_idx ON agencia_lab_persona (organization_id)`
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agencia_lab_negocio (
      organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      tipo_negocio text NOT NULL DEFAULT '',
      quienes text NOT NULL DEFAULT '',
      usar_propios boolean NOT NULL DEFAULT true,
      updated_at timestamp NOT NULL DEFAULT now()
    )`);
}

function esTipo(t: string): t is TipoCliente {
  return (CLAVES_TIPO as readonly string[]).includes(t);
}

function aDto(r: typeof labPersona.$inferSelect): ClienteDto {
  return {
    id: r.id,
    nombre: r.nombre,
    tipo: esTipo(r.tipo) ? r.tipo : "fuera_de_kb",
    guion: Array.isArray(r.guion) ? r.guion.filter((l) => typeof l === "string") : [],
    activo: r.activo,
    propio: r.propio,
  };
}

export async function listarClientes(organizationId: string): Promise<ClienteDto[]> {
  await asegurarTablas();
  const filas = await getDb()
    .select()
    .from(labPersona)
    .where(scoped(labPersona.organizationId, organizationId))
    .orderBy(asc(labPersona.orden), asc(labPersona.createdAt));
  return filas.map(aDto);
}

export async function leerNegocio(organizationId: string): Promise<NegocioDto | null> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(labNegocio)
    .where(scoped(labNegocio.organizationId, organizationId))
    .limit(1);
  return fila
    ? { tipoNegocio: fila.tipoNegocio, quienes: fila.quienes, usarPropios: fila.usarPropios }
    : null;
}

export async function guardarNegocio(
  organizationId: string,
  datos: Partial<NegocioDto>
): Promise<NegocioDto> {
  await asegurarTablas();
  const previo = await leerNegocio(organizationId);
  const nuevo: NegocioDto = {
    tipoNegocio: datos.tipoNegocio ?? previo?.tipoNegocio ?? "",
    quienes: datos.quienes ?? previo?.quienes ?? "",
    usarPropios: datos.usarPropios ?? previo?.usarPropios ?? true,
  };
  await getDb()
    .insert(labNegocio)
    .values({ organizationId, ...nuevo, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: labNegocio.organizationId,
      set: { ...nuevo, updatedAt: new Date() },
    });
  return nuevo;
}

/** «Volver a generar»: cambia los generados; los que agregó una persona se quedan. */
export async function reemplazarGenerados(
  organizationId: string,
  generados: ClienteInput[]
): Promise<ClienteDto[]> {
  await asegurarTablas();
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(labPersona)
      .where(scoped(labPersona.organizationId, organizationId, eq(labPersona.propio, false)));
    if (generados.length) {
      await tx.insert(labPersona).values(
        generados.map((g, i) => ({
          id: nuevoId(),
          organizationId,
          tipo: g.tipo,
          nombre: g.nombre,
          guion: g.guion,
          activo: true,
          propio: false,
          orden: i,
        }))
      );
    }
  });
  return listarClientes(organizationId);
}

export async function crearCliente(
  organizationId: string,
  datos: ClienteInput
): Promise<ClienteDto> {
  const actuales = await listarClientes(organizationId);
  if (actuales.length >= MAX_CLIENTES) {
    throw new ClienteLabError(409, "demasiados", `Máximo ${MAX_CLIENTES} clientes de prueba`);
  }
  const [fila] = await getDb()
    .insert(labPersona)
    .values({
      id: nuevoId(),
      organizationId,
      tipo: datos.tipo,
      nombre: datos.nombre,
      guion: datos.guion,
      activo: datos.activo ?? true,
      propio: true,
      orden: 100 + actuales.length,
    })
    .returning();
  return aDto(fila!);
}

export async function editarCliente(
  organizationId: string,
  id: string,
  datos: Partial<ClienteInput>
): Promise<ClienteDto> {
  await asegurarTablas();
  const [fila] = await getDb()
    .update(labPersona)
    .set({ ...datos, updatedAt: new Date() })
    .where(scoped(labPersona.organizationId, organizationId, eq(labPersona.id, id)))
    .returning();
  if (!fila) throw new ClienteLabError(404, "not_found", "Ese cliente de prueba ya no existe");
  return aDto(fila);
}

export async function borrarCliente(organizationId: string, id: string): Promise<void> {
  await asegurarTablas();
  await getDb()
    .delete(labPersona)
    .where(scoped(labPersona.organizationId, organizationId, eq(labPersona.id, id)));
}

/**
 * Los clientes propios que entran a la próxima corrida, o `null` si toca la
 * de fábrica (no los quiere usar, o no hay ninguno activo).
 */
export async function clientesParaCorrida(
  organizationId: string
): Promise<ClienteDto[] | null> {
  const negocio = await leerNegocio(organizationId);
  if (negocio && !negocio.usarPropios) return null;
  const activos = (await listarClientes(organizationId)).filter(
    (c) => c.activo && c.guion.length > 0
  );
  return activos.length ? activos : null;
}
