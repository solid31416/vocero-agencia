import { apiError, withAuth } from "@/lib/api";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { recordar } from "@/server/pedidos/recordar-saldo";
import { aDto, hoyIso, leerConfig, leerPedido } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Módulo de la agencia — «Recordárselo ahora»: le escribe al cliente cuánto queda de saldo. */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const org = session.organizationId;
  const f = await leerPedido(org, id);
  if (!f) return apiError(404, "not_found", "Pedido no encontrado");
  const config = await leerConfig(org);
  const r = await recordar(org, config, f, { apartar: false, hoy: hoyIso() });
  const final = await leerPedido(org, id);
  if (!r.ok) return apiError(409, "no_salio", r.detalle);
  return Response.json({ detalle: r.detalle, pedido: final ? aDto(final, config) : null });
});
