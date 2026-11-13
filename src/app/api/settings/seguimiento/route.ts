import { and, asc, eq, inArray } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { configSchema, describirDias, MAX_VARIABLES } from "@/lib/seguimiento";
import { countVariables } from "@/server/whatsapp/templates";
import { seguimientoEnabled } from "@/server/seguimiento/flag";
import { guardarConfig, leerConfig, ultimosEnvios } from "@/server/seguimiento/store";

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
    category: t.category,
    body: t.body,
    variables: countVariables(t.body),
  }));
}

async function etapas(organizationId: string) {
  return getDb()
    .select({ id: schema.pipelineStage.id, nombre: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
}

/** Módulo de la agencia — el seguimiento automático: ajustes, plantillas, etapas y bitácora. */
export const GET = withAuth(async (session) => {
  if (!seguimientoEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [config, plantillas, listaEtapas, envios] = await Promise.all([
    leerConfig(org),
    plantillasAprobadas(org),
    etapas(org),
    ultimosEnvios(org, { limite: 20 }),
  ]);
  return Response.json({ config, plantillas, etapas: listaEtapas, envios, puedeEditar: canConfigure(session.role) });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!seguimientoEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia el seguimiento");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  const c = body.data;
  const org = session.organizationId;

  const ids = c.pasos.flatMap((p) => (p.plantillaId ? [p.plantillaId] : []));
  if (ids.length) {
    const filas = await getDb()
      .select({ id: schema.template.id, body: schema.template.body })
      .from(schema.template)
      .where(
        scoped(
          schema.template.organizationId,
          org,
          and(inArray(schema.template.id, ids), eq(schema.template.status, "approved"))
        )
      );
    const porId = new Map(filas.map((f) => [f.id, countVariables(f.body)]));
    for (const p of c.pasos) {
      if (!p.plantillaId) continue;
      const n = porId.get(p.plantillaId);
      const paso = `el paso de ${describirDias(p.dias)}`;
      if (n === undefined) return apiError(422, "plantilla_invalida", `Elige una plantilla aprobada por Meta para ${paso}`);
      if (n > MAX_VARIABLES) {
        return apiError(422, "plantilla_invalida", `La plantilla de ${paso} usa más de ${MAX_VARIABLES} variables`);
      }
      if (p.variables.slice(0, n).filter(Boolean).length < n) {
        return apiError(422, "faltan_variables", `Llena todas las variables de la plantilla de ${paso}`);
      }
    }
  }
  // Las etapas excluidas, solo las que existen en este negocio.
  const validas = new Set((await etapas(org)).map((e) => e.id));
  const limpia = { ...c, excluirEtapas: c.excluirEtapas.filter((id) => validas.has(id)) };
  return Response.json({ config: await guardarConfig(org, limpia) });
});
