import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { configSchema } from "@/lib/espera-humano";
import { businessTimezone } from "@/server/analytics/period";
import { esperaEnabled } from "@/server/espera-humano/flag";
import { guardarConfig, leerConfig } from "@/server/espera-humano/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — la configuración de «Nadie ha contestado». */
export const GET = withAuth(async (session) => {
  if (!esperaEnabled()) return new Response(null, { status: 404 });
  return Response.json({
    config: await leerConfig(session.organizationId),
    zona: await businessTimezone(session.organizationId),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!esperaEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia este ajuste");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  return Response.json({ config: await guardarConfig(session.organizationId, configSchema.parse(body.data)) });
});
