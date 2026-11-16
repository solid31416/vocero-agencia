import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { leerReporte, mandarReporte } from "@/server/reporte-semanal/reporte";

export const dynamic = "force-dynamic";

/** «Mandármelo ahora»: el reporte de los últimos 7 días al teléfono guardado. */
export const POST = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra manda el reporte");
  const { config } = await leerReporte(session.organizationId);
  if (!config.telefonoDueno) return apiError(422, "sin_telefono", "Primero guarda el teléfono del dueño");
  const r = await mandarReporte(session.organizationId, config);
  return r.ok ? Response.json({ detalle: r.detalle }) : apiError(409, "no_salio", r.detalle);
});
