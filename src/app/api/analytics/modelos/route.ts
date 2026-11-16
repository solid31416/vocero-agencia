import { apiError, withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { PeriodError, periodFromRequest } from "@/server/analytics/period";
import { porModeloBlock } from "@/server/analytics/por-modelo";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Resultados por modelo (`?from=AAAA-MM-DD&to=AAAA-MM-DD`). */
export const GET = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  try {
    const period = await periodFromRequest(session.organizationId, new URL(req.url));
    return Response.json(await porModeloBlock(session.organizationId, period));
  } catch (err) {
    if (err instanceof PeriodError) return apiError(422, "invalid_period", err.message);
    throw err;
  }
});
