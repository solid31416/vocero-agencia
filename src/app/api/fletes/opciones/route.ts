import { apiError, withAuth } from "@/lib/api";
import { opcionesDeFlete } from "@/lib/fletes";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { leerFletes } from "@/server/fletes/store";
import { hoyIso } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

/**
 * Módulo de la agencia — Fletes: qué tarifas del tabulador sirven para llevar
 * N piezas a un destino (`?estado=&ciudad=&piezas=`). Para el cotizador.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const q = new URL(req.url).searchParams;
  const estado = q.get("estado")?.trim() ?? "";
  const piezas = Number(q.get("piezas") ?? "1");
  if (!estado) return apiError(422, "sin_estado", "Elige el estado");
  if (!Number.isFinite(piezas) || piezas < 1 || piezas > 1000) return apiError(422, "piezas", "Piezas de 1 a 1000");
  const fletes = await leerFletes(session.organizationId);
  return Response.json({
    origen: fletes.origen,
    opciones: opcionesDeFlete(fletes, { estado, ciudad: q.get("ciudad") ?? "", piezas }, hoyIso()),
  });
});
