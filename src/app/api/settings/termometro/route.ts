import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { configSchema, type ConfigTermometro } from "@/lib/termometro";
import { termometroEnabled } from "@/server/termometro/flag";
import { guardarConfig, leerConfig } from "@/server/termometro/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — encender o apagar el termómetro, el criterio y las etiquetas. */
export const GET = withAuth(async (session) => {
  if (!termometroEnabled()) return new Response(null, { status: 404 });
  return Response.json({
    config: await leerConfig(session.organizationId),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!termometroEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia el termómetro");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  const c: ConfigTermometro = configSchema.parse(body.data);
  return Response.json({ config: await guardarConfig(session.organizationId, c) });
});
