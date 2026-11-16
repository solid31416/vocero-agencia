import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { configSchema, textoDelReporte } from "@/lib/reporte-semanal";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { calcularReporte, guardarReporte, leerReporte } from "@/server/reporte-semanal/reporte";
import { countVariables } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Ajustes → Reporte semanal: la configuración y cómo saldría hoy. */
export const GET = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [estado, reporte, plantillas] = await Promise.all([
    leerReporte(org),
    calcularReporte(org),
    getDb()
      .select()
      .from(schema.template)
      .where(scoped(schema.template.organizationId, org, eq(schema.template.status, "approved"))),
  ]);
  return Response.json({
    ...estado,
    vistaPrevia: textoDelReporte(reporte),
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
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia el reporte");
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  if (body.data.activo && !body.data.telefonoDueno) {
    return apiError(422, "sin_telefono", "Escribe el teléfono del dueño para mandarle el reporte");
  }
  return Response.json({ config: await guardarReporte(session.organizationId, body.data) });
});
