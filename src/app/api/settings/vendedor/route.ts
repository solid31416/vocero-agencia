import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { vendedorSchema } from "@/lib/vendedor";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { guardarConfig, leerConfig } from "@/server/cotizaciones/store";
import { leerConfig as leerResumen } from "@/server/resumen-traspaso/store";

export const dynamic = "force-dynamic";

/**
 * Módulo de la agencia — Ajustes → Ventas → Vendedor. Lee y guarda SOLO la
 * parte del vendedor dentro de la configuración de cotizaciones, para no
 * pisar lo que otra pestaña esté editando en Ajustes → Cotizaciones.
 */
export const GET = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [config, resumen] = await Promise.all([leerConfig(org), leerResumen(org).catch(() => null)]);
  const modelos = config.productos.filter((p) => !p.extra);
  return Response.json({
    vendedor: config.vendedor,
    moneda: config.moneda,
    catalogo: {
      modelos: modelos.length,
      modelosSinPrecio: modelos.filter((p) => !(p.precio > 0)).map((p) => p.nombre),
      extras: config.productos.filter((p) => p.extra).map((p) => p.nombre),
    },
    // A dónde llegan los avisos por WhatsApp (los últimos 4 dígitos).
    telefonoAviso: resumen?.telefonoDueno ? resumen.telefonoDueno.slice(-4) : null,
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia al vendedor");
  }
  const body = await parseBody(req, vendedorSchema);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  const actual = await leerConfig(org);
  const config = await guardarConfig(org, { ...actual, vendedor: body.data });
  return Response.json({ vendedor: config.vendedor });
});
