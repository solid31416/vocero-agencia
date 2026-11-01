import { apiError, parseBody, withAuth } from "@/lib/api";
import { manualSchema } from "@/lib/termometro";
import { publish } from "@/server/events/bus";
import { termometroEnabled } from "@/server/termometro/flag";
import { existeConversacion, guardarClasificacion, leerConfig, volverAutomatico } from "@/server/termometro/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Módulo de la agencia — corregir a mano la temperatura y las etiquetas (la IA ya no las toca). */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  if (!termometroEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const org = session.organizationId;
  if (!(await existeConversacion(org, id))) return apiError(404, "not_found", "Conversación no encontrada");
  const body = await parseBody(req, manualSchema);
  if (!body.ok) return body.response;
  const validas = new Set((await leerConfig(org)).etiquetas.map((e) => e.id));
  await guardarClasificacion(
    org,
    id,
    {
      temperatura: body.data.temperatura,
      etiquetas: body.data.etiquetas.filter((e, i, a) => validas.has(e) && a.indexOf(e) === i),
      razon: "Puesto a mano",
    },
    { manual: true }
  );
  publish(org, { type: "conversation.updated", data: { conversation: { id } } });
  return Response.json({ ok: true });
});

/** Regresar a automático: la IA la vuelve a clasificar en la siguiente pasada. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!termometroEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  await volverAutomatico(session.organizationId, id);
  publish(session.organizationId, { type: "conversation.updated", data: { conversation: { id } } });
  return Response.json({ ok: true });
});
