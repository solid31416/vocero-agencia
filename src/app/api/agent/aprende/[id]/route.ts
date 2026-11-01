import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { LIMITE_PREGUNTA, LIMITE_RESPUESTA } from "@/lib/aprende-traspasos";
import { aprendeEnabled } from "@/server/aprende-traspasos/flag";
import { aprobar, descartar } from "@/server/aprende-traspasos/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("aprobar"),
    pregunta: z.string().trim().min(1).max(LIMITE_PREGUNTA),
    respuesta: z.string().trim().min(1).max(LIMITE_RESPUESTA),
  }),
  z.object({ accion: z.literal("descartar") }),
]);

/** Módulo de la agencia — aprobar (entra al conocimiento, con el texto editado) o descartar una sugerencia. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!aprendeEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia el conocimiento del agente");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const r =
    body.data.accion === "aprobar"
      ? await aprobar(session.organizationId, id, { pregunta: body.data.pregunta, respuesta: body.data.respuesta })
      : await descartar(session.organizationId, id);
  if (r === "no_existe") return apiError(404, "not_found", "La sugerencia ya no está pendiente");
  return Response.json({ ok: true });
});
