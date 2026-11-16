import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { pagoInputSchema } from "@/lib/pedidos";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { quitarPago, registrarPago } from "@/server/pedidos/servicio";
import { aDto, hoyIso, leerConfig } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Módulo de la agencia — anticipo y saldo: registra un pago del pedido. El
 * primero (el anticipo) pasa al lead a la etapa «Anticipo…» del embudo.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, pagoInputSchema);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  const r = await registrarPago(org, id, body.data, session.userId, hoyIso());
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({
    pedido: aDto(r.valor.pedido, await leerConfig(org)),
    etapaEmbudo: r.valor.etapaEmbudo,
    aviso: r.valor.aviso,
  });
});

/** Quita un pago capturado por error (`?pagoId=`). Solo quien administra. */
export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra quita pagos");
  const { id } = await ctx.params;
  const pagoId = new URL(req.url).searchParams.get("pagoId")?.trim();
  if (!pagoId) return apiError(422, "sin_pago", "Falta el pago");
  const org = session.organizationId;
  const r = await quitarPago(org, id, pagoId);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({ pedido: aDto(r.valor, await leerConfig(org)) });
});
