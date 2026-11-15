import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { cambioSchema } from "@/lib/biblioteca";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { aDto, borrarArchivo, cambiarArchivo } from "@/server/biblioteca/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Cambia el título, el «cuándo mandarlo» o si está activo. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia la biblioteca");
  const { id } = await ctx.params;
  const body = await parseBody(req, cambioSchema);
  if (!body.ok) return body.response;
  const fila = await cambiarArchivo(session.organizationId, id, body.data);
  if (!fila) return apiError(404, "not_found", "Ese archivo ya no existe");
  return Response.json({ archivo: aDto(fila) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra borra archivos");
  const { id } = await ctx.params;
  const borrado = await borrarArchivo(session.organizationId, id);
  if (!borrado) return apiError(404, "not_found", "Ese archivo ya no existe");
  return Response.json({ ok: true });
});
