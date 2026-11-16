import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/server/whatsapp/templates";
import { canConfigure } from "@/lib/auth/roles";
import { configSchema } from "@/lib/cotizaciones";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { guardarConfig, leerConfig, leerLogo, listarCotizaciones } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Ajustes → Cotizaciones: datos, productos, condiciones y las últimas hechas. */
export const GET = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [config, logo, cotizaciones, plantillas] = await Promise.all([
    leerConfig(org),
    leerLogo(org),
    listarCotizaciones(org, { limite: 50 }),
    getDb()
      .select()
      .from(schema.template)
      .where(scoped(schema.template.organizationId, org, eq(schema.template.status, "approved"))),
  ]);
  return Response.json({
    config,
    tieneLogo: Boolean(logo),
    cotizaciones,
    // Para el recordatorio de seguimiento pasadas las 24 h.
    plantillas: plantillas.map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      variables: countVariables(t.body),
    })),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia las cotizaciones");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  return Response.json({ config: await guardarConfig(session.organizationId, configSchema.parse(body.data)) });
});
