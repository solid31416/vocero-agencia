import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { aDto, borrarBorrador, cambiarEstado } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({ estado: z.enum(["enviada", "aceptada", "rechazada"]) });

/** Marca una cotización ya enviada como aceptada, rechazada (o de vuelta a enviada). */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const f = await cambiarEstado(session.organizationId, id, body.data.estado);
  if (!f) return apiError(404, "no_existe", "Cotización no encontrada (o todavía es borrador)");
  return Response.json({ cotizacion: aDto(f) });
});

/** Solo un borrador se borra: lo enviado queda como constancia. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  if (!(await borrarBorrador(session.organizationId, id))) {
    return apiError(409, "no_borrable", "Solo se borran los borradores");
  }
  return Response.json({ ok: true });
});
