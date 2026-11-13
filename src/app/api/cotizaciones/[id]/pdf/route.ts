import { apiError, withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { pdfDeCotizacion } from "@/server/cotizaciones/servicio";
import { leerCotizacion } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** El PDF (vista previa de un borrador o copia de una enviada). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const fila = await leerCotizacion(session.organizationId, id);
  if (!fila) return apiError(404, "no_existe", "Cotización no encontrada");
  const { data, nombre } = await pdfDeCotizacion(session.organizationId, fila);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${nombre}"`,
      "cache-control": "private, no-store",
    },
  });
});
