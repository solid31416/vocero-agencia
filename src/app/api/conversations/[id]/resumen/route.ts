import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { resumenEnabled } from "@/server/resumen-traspaso/flag";
import { generando, generarResumen } from "@/server/resumen-traspaso/generar";
import { aDto, leerConfig, leerResumen } from "@/server/resumen-traspaso/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Módulo de la agencia — el resumen para quien atiende de esta conversación. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!resumenEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const org = session.organizationId;
  const config = await leerConfig(org);
  const fila = config.activo ? await leerResumen(org, id) : null;
  return Response.json({
    activo: config.activo,
    resumen: fila ? aDto(fila) : null,
    generando: generando(id),
  });
});

/** Armar (o rehacer) el resumen ahora: el botón «Resumir» / «Actualizar». No avisa al dueño. */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!resumenEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const org = session.organizationId;
  const [conv] = await getDb()
    .select({
      handoffReason: schema.conversation.handoffReason,
      handoffAt: schema.conversation.handoffAt,
      aiEnabled: schema.conversation.aiEnabled,
    })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, org, eq(schema.conversation.id, id)))
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  const motivo =
    conv.handoffAt && conv.handoffReason ? conv.handoffReason : conv.aiEnabled ? "pedido" : "manual";
  const r = await generarResumen(org, id, motivo, { avisar: false, forzar: true });
  if (!r.ok) {
    const status = r.codigo === "no_existe" ? 404 : r.codigo === "ia_fallo" ? 502 : 409;
    return apiError(status, r.codigo, r.detalle);
  }
  const fila = await leerResumen(org, id);
  return Response.json({ activo: true, resumen: fila ? aDto(fila) : null, generando: false });
});
