import { parseBody, withAuth } from "@/lib/api";
import { clientePatchSchema } from "@/lib/lab-a-la-medida";
import { conModulo } from "@/server/lab/a-la-medida/http";
import { borrarCliente, editarCliente } from "@/server/lab/a-la-medida/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Módulo de la agencia — editar un cliente de prueba (nombre, tipo, guion, usar). */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) =>
  conModulo(async () => {
    const { id } = await ctx.params;
    const body = await parseBody(req, clientePatchSchema);
    if (!body.ok) return body.response;
    return Response.json({ cliente: await editarCliente(session.organizationId, id, body.data) });
  })
);

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) =>
  conModulo(async () => {
    const { id } = await ctx.params;
    await borrarCliente(session.organizationId, id);
    return new Response(null, { status: 204 });
  })
);
