import { apiError, parseBody, withAuth } from "@/lib/api";
import { envioInputSchema } from "@/lib/fletes";
import { guardarEnvio } from "@/server/fletes/envios";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { aDto, leerConfig } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Módulo de la agencia — Fletes: guarda el seguimiento del envío del pedido. */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, envioInputSchema);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  const r = await guardarEnvio(org, id, body.data);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({ pedido: aDto(r.valor, await leerConfig(org)) });
});

/** Quita el envío (capturado por error). */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const org = session.organizationId;
  const r = await guardarEnvio(org, id, null);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({ pedido: aDto(r.valor, await leerConfig(org)) });
});
