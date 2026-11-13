import { withAuth, apiError, parseBody } from "@/lib/api";
import { pedidoInputSchema } from "@/lib/pedidos";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { crearPedido } from "@/server/pedidos/servicio";
import { aDto, leerConfig, listarPedidos } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

/** Los pedidos (todos, o los de una conversación) y las etapas para moverlos. */
export const GET = withAuth(async (session, req: Request) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const conversationId = new URL(req.url).searchParams.get("conversationId")?.trim() || undefined;
  const org = session.organizationId;
  const [config, filas] = await Promise.all([leerConfig(org), listarPedidos(org, { conversationId })]);
  return Response.json({
    pedidos: filas.map((f) => aDto(f, config)),
    etapas: config.etapas,
  });
});

/** Un pedido nuevo de una conversación; entra en la primera etapa. */
export const POST = withAuth(async (session, req: Request) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const body = await parseBody(req, pedidoInputSchema);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  const r = await crearPedido(org, body.data, session.userId);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({ pedido: aDto(r.valor, await leerConfig(org)) }, { status: 201 });
});
