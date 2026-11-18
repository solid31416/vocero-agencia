import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

/**
 * Módulo de la agencia — el nombre real del cliente, ligado a su número
 * (bandera `NOMBRE_REAL`).
 *
 * El nombre de un contacto nace del perfil de WhatsApp, y ese perfil muchas
 * veces es una letra («J»), un apodo o un emoji. Cuando el cliente se
 * presenta («soy Saúl Garza») o dice a nombre de quién va la cotización, el
 * agente lo guarda en la ficha (`nombre`, y `empresa` si habla por un
 * negocio) y aquí pasa a ser el nombre del contacto: lo ven la bandeja, las
 * cotizaciones y los pedidos.
 *
 * Quién manda, de más a menos: lo que escribió una persona en el CRM
 * (`manual`, nadie lo pisa) → lo que dijo el cliente (`agente`, el perfil de
 * WhatsApp ya no lo pisa) → el perfil (`perfil`). Apagado por defecto (ADR-001).
 */
export function nombreRealEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.NOMBRE_REAL);
}

export const MAX_NOMBRE = 120;

/** Un texto de la ficha que sirve como nombre; null si no (vacío, una letra, puros signos). */
export function nombreUtil(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/\s+/g, " ").trim().slice(0, MAX_NOMBRE);
  const letras = limpio.match(/\p{L}/gu)?.length ?? 0;
  return letras >= 2 ? limpio : null;
}

/**
 * Empresa y persona juntas, como las quiere ver el dueño: «Domos Garza (Saúl)».
 * Si falta una, la otra; si son la misma, una sola vez.
 */
export function empresaYPersona(empresa: string | null, persona: string | null): string | null {
  if (!empresa) return persona;
  if (!persona) return empresa;
  if (persona.toLowerCase() === empresa.toLowerCase()) return persona;
  // Si la persona ya trae la empresa («Domos Garza (Saúl)»), se deja como viene.
  if (persona.toLowerCase().includes(empresa.toLowerCase())) return persona;
  return `${empresa} (${persona})`.slice(0, MAX_NOMBRE);
}

/**
 * Cómo se llamará el contacto según lo que dijo el cliente: «Empresa
 * (Persona)» si habla por un negocio, si no su nombre, o solo la empresa.
 * Null si no dijo ninguno.
 */
export function nombreDeLaFicha(ficha: Record<string, unknown> | null | undefined): string | null {
  if (!ficha) return null;
  return empresaYPersona(nombreUtil(ficha.empresa), nombreUtil(ficha.nombre));
}

/** A nombre de quién va una cotización: «Domos del Norte (Saúl Garza)», o lo que haya. */
export function aNombreDe(ficha: Record<string, unknown> | null | undefined, nombreContacto: string): string {
  const nombre = nombreUtil(ficha?.nombre) ?? nombreContacto.trim();
  return (empresaYPersona(nombreUtil(ficha?.empresa), nombre) ?? nombre).slice(0, MAX_NOMBRE);
}

/**
 * Pone el nombre que dio el cliente, salvo que una persona ya haya escrito
 * otro en el CRM. Devuelve true si cambió algo.
 */
export async function ponerNombreReal(organizationId: string, contactId: string, nombre: string): Promise<boolean> {
  const filas = await getDb()
    .update(schema.contact)
    .set({ name: nombre, nameSource: "agente", updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        and(
          eq(schema.contact.id, contactId),
          inArray(schema.contact.nameSource, ["perfil", "agente"]),
          ne(schema.contact.name, nombre)
        )
      )
    )
    .returning({ id: schema.contact.id });
  return filas.length > 0;
}

/**
 * El `/reset` de pruebas: el nombre que dio el cliente se olvida y el
 * contacto vuelve a tomar el de su perfil con el siguiente mensaje.
 */
export async function olvidarNombreReal(organizationId: string, contactId: string): Promise<void> {
  await getDb()
    .update(schema.contact)
    .set({ nameSource: "perfil", updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        and(eq(schema.contact.id, contactId), eq(schema.contact.nameSource, "agente"))
      )
    );
}
