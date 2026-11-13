import { and, eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { configSchema, MAX_VARIABLES } from "@/lib/pedidos";
import { countVariables } from "@/server/whatsapp/templates";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { guardarConfig, leerConfig } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Ajustes → Pedidos: etapas, mensajes y plantilla. */
export const GET = withAuth(async (session) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const filas = await getDb()
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, org, eq(schema.template.status, "approved")));
  return Response.json({
    config: await leerConfig(org),
    plantillas: filas.map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      body: t.body,
      variables: countVariables(t.body),
    })),
    puedeEditar: canConfigure(session.role),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!pedidosEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia los pedidos");
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  const c = body.data;
  if (c.plantillaId) {
    const [t] = await getDb()
      .select({ body: schema.template.body })
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
    if (countVariables(t.body) > MAX_VARIABLES) {
      return apiError(
        422,
        "plantilla_invalida",
        "La plantilla puede usar hasta 3 variables: {{1}} nombre, {{2}} folio, {{3}} etapa"
      );
    }
  }
  return Response.json({ config: await guardarConfig(session.organizationId, c) });
});
