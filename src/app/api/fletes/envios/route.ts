import { withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { pedidosConEnvio } from "@/server/fletes/envios";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { aDto, leerConfig } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Fletes: los pedidos con envío, para darles seguimiento. */
export const GET = withAuth(async (session) => {
  if (!cotizacionesEnabled() || !pedidosEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [filas, config] = await Promise.all([pedidosConEnvio(org), leerConfig(org)]);
  return Response.json({ pedidos: filas.map((f) => aDto(f, config)) });
});
