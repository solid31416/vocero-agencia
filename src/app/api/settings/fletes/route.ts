import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { configFletesSchema } from "@/lib/fletes";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { leerConfig as leerCotizaciones } from "@/server/cotizaciones/store";
import { guardarFletes, leerFletes } from "@/server/fletes/store";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { hoyIso } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

/**
 * Módulo de la agencia — Ajustes → Ventas → Fletes: transportistas y
 * tabulador. Va con la bandera COTIZACIONES. Los costos son internos: solo
 * los ve el equipo, nunca el cliente ni el agente.
 */
export const GET = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [fletes, cot] = await Promise.all([leerFletes(org), leerCotizaciones(org)]);
  return Response.json({
    fletes,
    moneda: cot.moneda ?? "MXN",
    hoy: hoyIso(),
    conPedidos: pedidosEnabled(),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia los fletes");
  const body = await parseBody(req, configFletesSchema);
  if (!body.ok) return body.response;
  const fletes = await guardarFletes(session.organizationId, body.data);
  return Response.json({ fletes });
});
