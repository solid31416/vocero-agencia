import { and, eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { configSchema, type ResumenDto } from "@/lib/contador-mensajes";
import { countVariables } from "@/server/whatsapp/templates";
import { contadorEnabled } from "@/server/contador-mensajes/flag";
import { actualizarOficial } from "@/server/contador-mensajes/oficial";
import { calcularMes, olvidarCache } from "@/server/contador-mensajes/resumen";
import { guardarConfig, leerOficial, recibidosDelMes } from "@/server/contador-mensajes/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — el contador de mensajes y costo de Meta del mes. */
export const GET = withAuth(async (session) => {
  if (!contadorEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const { resumen, mes, config } = await calcularMes(org);
  const [oficial, recibidos, plantillas] = await Promise.all([
    leerOficial(org, mes.mes),
    recibidosDelMes(org, mes),
    getDb()
      .select({ id: schema.template.id, name: schema.template.name, language: schema.template.language, body: schema.template.body })
      .from(schema.template)
      .where(scoped(schema.template.organizationId, org, eq(schema.template.status, "approved"))),
  ]);
  const { ultimoAviso, ultimoAvisoDetalle, ultimoAvisoEn, ...ajustes } = config;
  const dto: ResumenDto = {
    ...resumen,
    mes: mes.mes,
    config: ajustes,
    oficial,
    recibidos,
    puedeEditar: canConfigure(session.role),
    plantillasDisponibles: plantillas
      .filter((t) => countVariables(t.body) <= 1)
      .map(({ id, name, language }) => ({ id, name, language })),
    ultimoAviso:
      ultimoAviso && ultimoAvisoEn
        ? { clave: ultimoAviso, detalle: ultimoAvisoDetalle, en: ultimoAvisoEn.toISOString() }
        : null,
  };
  return Response.json(dto);
});

/** Ajustes del aviso y de las tarifas (solo quien administra). */
export const PUT = withAuth(async (session, req: Request) => {
  if (!contadorEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia los ajustes del contador");
  }
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
    if (countVariables(t.body) > 1) {
      return apiError(422, "plantilla_invalida", "La plantilla del aviso puede usar una sola variable: {{1}} es el aviso");
    }
  }
  const config = await guardarConfig(session.organizationId, c);
  olvidarCache(session.organizationId);
  return Response.json({ config });
});

/** «Actualizar ahora»: pide el reporte de costos a Meta sin esperar las 3 horas. */
export const POST = withAuth(async (session) => {
  if (!contadorEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra pide el reporte a Meta");
  }
  const oficial = await actualizarOficial(session.organizationId, new Date(), true);
  return Response.json({ oficial });
});
