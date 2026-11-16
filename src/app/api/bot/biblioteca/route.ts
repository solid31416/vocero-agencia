import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { enviarDelAgente } from "@/server/biblioteca/agente";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  archivoId: z.string().min(1).max(64),
});

/**
 * Módulo de la agencia — el cerebro manda un archivo de la Biblioteca.
 *
 * 404 vacío sin la bandera `BIBLIOTECA`. 409 tipados: ai_paused ·
 * herramienta_apagada · archivo_apagado · ya_enviado · limite ·
 * window_closed. 404 `archivo_desconocido` si el id no es de la biblioteca.
 */
export async function POST(req: Request) {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Mismo gate que los mensajes: el agente jamás habla en una conversación
  // que tomó una persona.
  const [conv] = await getDb()
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.aiEnabled || conv.handoffAt) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }

  const r = await enviarDelAgente({
    organizationId,
    conversationId: body.data.conversationId,
    archivoId: body.data.archivoId,
    esPrueba: conv.isTest,
  });
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({
    messageId: r.messageId,
    titulo: r.titulo,
    status: "sent",
    enviados: r.enviados,
    total: r.total,
  });
}
