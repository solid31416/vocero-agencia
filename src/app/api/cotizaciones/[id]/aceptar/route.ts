import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { aceptarCotizacion } from "@/server/cotizaciones/aceptar";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { aDto as pedidoDto, leerConfig as configPedidos } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  crearPedido: z.boolean().default(true),
  avisar: z.boolean().default(true),
  fechaEstimada: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD")
    .nullable()
    .default(null),
  concepto: z.string().trim().max(300).optional(),
  monto: z.number().min(0).max(1e10).nullable().optional(),
});

/**
 * Módulo de la agencia — el cliente aceptó: la cotización queda «aceptada» y,
 * con la bandera PEDIDOS, nace su pedido con las partidas y el total.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  const r = await aceptarCotizacion({
    organizationId: org,
    cotizacionId: id,
    ...body.data,
    userId: session.userId,
  });
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  return Response.json({
    cotizacion: r.cotizacion,
    pedido: r.pedido ? pedidoDto(r.pedido, await configPedidos(org)) : null,
    yaExistia: r.yaExistia,
    avisoPedido: r.avisoPedido,
  });
});
