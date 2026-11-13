import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { sugerirPartidas } from "@/server/cotizaciones/servicio";
import { contactoDeConversacion } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().trim().min(1) });

/** «Que la IA la llene»: productos y cantidades salidos de la plática; precios de la lista. */
export const POST = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  if (!(await contactoDeConversacion(session.organizationId, body.data.conversationId))) {
    return apiError(404, "no_existe", "Conversación no encontrada");
  }
  const r = await sugerirPartidas(session.organizationId, body.data.conversationId);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json(r);
});
