import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { cambioSchema } from "@/lib/pedidos";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { borrarPedido, cambiarPedido } from "@/server/pedidos/servicio";
import { aDto, leerConfig } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mueve el pedido de etapa (avisando al cliente si se pide) o corrige sus datos. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, cambioSchema);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  const r = await cambiarPedido(org, id, body.data, session.userId);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({ pedido: aDto(r.valor, await leerConfig(org)) });
});

/** Quita un pedido capturado por error. Solo quien administra. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra borra pedidos");
  const { id } = await ctx.params;
  if (!(await borrarPedido(session.organizationId, id))) return apiError(404, "not_found", "Pedido no encontrado");
  return Response.json({ ok: true });
});
