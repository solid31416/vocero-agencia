import { and, eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { configSchema } from "@/lib/recordatorios";
import { countVariables } from "@/server/whatsapp/templates";
import { recordatoriosEnabled } from "@/server/recordatorios/flag";
import { guardarConfig, leerConfig, ultimosEnvios } from "@/server/recordatorios/store";

export const dynamic = "force-dynamic";

async function plantillasAprobadas(organizationId: string) {
  const filas = await getDb()
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.status, "approved")));
  return filas.map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    body: t.body,
    variables: countVariables(t.body),
  }));
}

/** Módulo de la agencia — los recordatorios de cita: ajustes, plantillas y bitácora. */
export const GET = withAuth(async (session) => {
  if (!recordatoriosEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  return Response.json({
    config: await leerConfig(org),
    plantillas: await plantillasAprobadas(org),
    envios: await ultimosEnvios(org),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!recordatoriosEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia los recordatorios");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  const c = body.data;
  if (c.plantillaId) {
    const [t] = await getDb()
      .select({ id: schema.template.id, body: schema.template.body })
      .from(schema.template)
      .where(
        scoped(
          schema.template.organizationId,
          session.organizationId,
          and(eq(schema.template.id, c.plantillaId), eq(schema.template.status, "approved"))
        )
      )
      .limit(1);
    if (!t) return apiError(422, "plantilla_invalida", "Elige una plantilla aprobada por Meta");
    if (countVariables(t.body) > 4) {
      return apiError(
        422,
        "plantilla_invalida",
        "La plantilla puede usar hasta 4 variables: {{1}} nombre, {{2}} fecha, {{3}} hora, {{4}} enlace"
      );
    }
  }
  return Response.json({ config: await guardarConfig(session.organizationId, c) });
});
