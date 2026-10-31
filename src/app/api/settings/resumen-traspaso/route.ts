import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { configSchema, type ConfigResumen } from "@/lib/resumen-traspaso";
import { resumenEnabled } from "@/server/resumen-traspaso/flag";
import { guardarConfig, leerConfig } from "@/server/resumen-traspaso/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — encender o apagar el resumen para quien atiende, y el aviso al dueño. */
export const GET = withAuth(async (session) => {
  if (!resumenEnabled()) return new Response(null, { status: 404 });
  return Response.json({
    config: await leerConfig(session.organizationId),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!resumenEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia el resumen");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  const c: ConfigResumen = configSchema.parse(body.data);
  if (c.avisarDueno && !c.telefonoDueno) {
    return apiError(422, "sin_telefono", "Escribe el teléfono al que llega el aviso");
  }
  return Response.json({ config: await guardarConfig(session.organizationId, c) });
});
