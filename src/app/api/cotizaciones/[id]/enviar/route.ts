import { apiError, withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { enviarCotizacion } from "@/server/cotizaciones/servicio";
import { aDto, leerCotizacion } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Manda el borrador por WhatsApp como PDF (solo con la ventana de 24 h abierta). */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const r = await enviarCotizacion(session.organizationId, id);
  if (!r.ok) return apiError(r.status, r.codigo, r.detalle);
  const fila = await leerCotizacion(session.organizationId, id);
  return Response.json({ ok: true, messageId: r.messageId, cotizacion: fila ? aDto(fila) : null });
});
