import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { configFletesSchema, FLETES_POR_DEFECTO, type ConfigFletes } from "@/lib/fletes";

/**
 * Módulo de la agencia — Fletes: transportistas y tabulador de una
 * organización, en un solo documento (son pocos renglones y se editan juntos).
 * Como los demás módulos, la tabla se crea sola, idempotente.
 */

export const fleteConfig = pgTable("agencia_flete_config", {
  organizationId: text("organization_id").primaryKey(),
  config: jsonb("config").$type<ConfigFletes>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

let lista: Promise<void> | null = null;

export function asegurarTablas(): Promise<void> {
  lista ??= getDb()
    .execute(
      sql`CREATE TABLE IF NOT EXISTS agencia_flete_config (
        organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        config jsonb NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      )`
    )
    .then(() => undefined)
    .catch((err) => {
      lista = null;
      throw err;
    });
  return lista;
}

export async function leerFletes(organizationId: string): Promise<ConfigFletes> {
  await asegurarTablas();
  const [fila] = await getDb()
    .select()
    .from(fleteConfig)
    .where(scoped(fleteConfig.organizationId, organizationId))
    .limit(1);
  if (!fila) return FLETES_POR_DEFECTO;
  const r = configFletesSchema.safeParse(fila.config);
  return r.success ? r.data : FLETES_POR_DEFECTO;
}

export async function guardarFletes(organizationId: string, c: ConfigFletes): Promise<ConfigFletes> {
  await asegurarTablas();
  await getDb()
    .insert(fleteConfig)
    .values({ organizationId, config: c, updatedAt: new Date() })
    .onConflictDoUpdate({ target: fleteConfig.organizationId, set: { config: c, updatedAt: new Date() } });
  return c;
}
