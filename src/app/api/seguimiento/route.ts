import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { seguimientoEnabled } from "@/server/seguimiento/flag";
import { pausar } from "@/server/seguimiento/store";
import { estadoConversacion } from "@/server/seguimiento/worker";

export const dynamic = "force-dynamic";

async function existe(organizationId: string, conversationId: string): Promise<boolean> {
  const [c] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  return Boolean(c);
}

/** El seguimiento de una conversación: si corre, por qué no, el siguiente paso y lo que ya salió. */
export const GET = withAuth(async (session, req: Request) => {
  if (!seguimientoEnabled()) return new Response(null, { status: 404 });
  const conversationId = new URL(req.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) return apiError(400, "invalid", "Falta conversationId");
  if (!(await existe(session.organizationId, conversationId))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  return Response.json(await estadoConversacion(session.organizationId, conversationId));
});

const pausaSchema = z.object({ conversationId: z.string().trim().min(1).max(60), pausada: z.boolean() });

/** Detener (o reanudar) el seguimiento para un cliente. Cualquiera del equipo puede. */
export const POST = withAuth(async (session, req: Request) => {
  if (!seguimientoEnabled()) return new Response(null, { status: 404 });
  const body = await parseBody(req, pausaSchema);
  if (!body.ok) return body.response;
  const { conversationId, pausada } = body.data;
  if (!(await existe(session.organizationId, conversationId))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  await pausar(session.organizationId, conversationId, pausada, session.userId);
  return Response.json(await estadoConversacion(session.organizationId, conversationId));
});
