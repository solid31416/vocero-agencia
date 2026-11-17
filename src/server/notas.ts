import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { NOTA_MAX, puedeBorrarNota, type NotaDto } from "@/lib/notas";
import { publish } from "@/server/events/bus";

/**
 * 050 — Notas internas de una conversación.
 *
 * Nunca tocan `message`: ni se envían, ni se despachan, ni cuentan como
 * respuesta. Por eso viven aquí y no en `inbox/`.
 */

export class NotaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const notaSchema = z.object({
  texto: z.string().trim().min(1, "la nota no puede ir vacía").max(NOTA_MAX),
});

type Quien = { organizationId: string; userId: string; configura: boolean };

async function conversacionDeLaOrganizacion(organizationId: string, conversationId: string) {
  const [conv] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conv) throw new NotaError(404, "not_found", "Conversación no encontrada");
}

function aDto(
  fila: typeof schema.conversationNote.$inferSelect,
  autorNombre: string | null,
  quien: Quien
): NotaDto {
  return {
    id: fila.id,
    conversationId: fila.conversationId,
    texto: fila.texto,
    createdAt: fila.createdAt.toISOString(),
    autor: fila.authorUserId ? { id: fila.authorUserId, nombre: autorNombre ?? "Alguien del equipo" } : null,
    puedeBorrar: puedeBorrarNota(fila.authorUserId, quien.userId, quien.configura),
  };
}

export async function listarNotas(quien: Quien, conversationId: string): Promise<NotaDto[]> {
  await conversacionDeLaOrganizacion(quien.organizationId, conversationId);
  const filas = await getDb()
    .select({ nota: schema.conversationNote, autor: schema.user.name })
    .from(schema.conversationNote)
    .leftJoin(schema.user, eq(schema.user.id, schema.conversationNote.authorUserId))
    .where(
      scoped(
        schema.conversationNote.organizationId,
        quien.organizationId,
        eq(schema.conversationNote.conversationId, conversationId)
      )
    )
    .orderBy(asc(schema.conversationNote.createdAt));
  return filas.map((f) => aDto(f.nota, f.autor, quien));
}

export async function crearNota(
  quien: Quien,
  conversationId: string,
  texto: string
): Promise<NotaDto> {
  await conversacionDeLaOrganizacion(quien.organizationId, conversationId);
  const [autor] = await getDb()
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, quien.userId))
    .limit(1);
  const [fila] = await getDb()
    .insert(schema.conversationNote)
    .values({
      id: newId("conversationNote"),
      organizationId: quien.organizationId,
      conversationId,
      authorUserId: quien.userId,
      texto,
    })
    .returning();
  const dto = aDto(fila!, autor?.name ?? null, quien);
  // Al resto del equipo le llega con `puedeBorrar` calculado para el autor;
  // cada cliente lo corrige con lo que sabe de sí mismo (ver inbox-client).
  publish(quien.organizationId, { type: "note.new", data: { conversationId, note: dto } });
  return dto;
}

export async function borrarNota(quien: Quien, conversationId: string, noteId: string): Promise<void> {
  const db = getDb();
  const [fila] = await db
    .select()
    .from(schema.conversationNote)
    .where(
      scoped(
        schema.conversationNote.organizationId,
        quien.organizationId,
        eq(schema.conversationNote.id, noteId),
        eq(schema.conversationNote.conversationId, conversationId)
      )
    )
    .limit(1);
  if (!fila) throw new NotaError(404, "not_found", "Nota no encontrada");
  if (!puedeBorrarNota(fila.authorUserId, quien.userId, quien.configura)) {
    throw new NotaError(403, "forbidden", "Solo quien la escribió o quien administra puede borrarla");
  }
  await db
    .delete(schema.conversationNote)
    .where(scoped(schema.conversationNote.organizationId, quien.organizationId, eq(schema.conversationNote.id, noteId)));
  publish(quien.organizationId, { type: "note.deleted", data: { conversationId, noteId } });
}

/**
 * Módulo de la agencia — una nota que deja el sistema (p. ej. «el agente
 * preparó una cotización»): sin autor, visible para todo el equipo.
 */
export async function crearNotaDelSistema(
  organizationId: string,
  conversationId: string,
  texto: string
): Promise<void> {
  const [fila] = await getDb()
    .insert(schema.conversationNote)
    .values({
      id: newId("conversationNote"),
      organizationId,
      conversationId,
      authorUserId: null,
      texto: texto.slice(0, NOTA_MAX),
    })
    .returning();
  const dto = aDto(fila!, null, { organizationId, userId: "", configura: false });
  publish(organizationId, { type: "note.new", data: { conversationId, note: dto } });
}
