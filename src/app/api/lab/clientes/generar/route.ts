import { parseBody, withAuth } from "@/lib/api";
import { generarSchema } from "@/lib/lab-a-la-medida";
import { generarClientes } from "@/server/lab/a-la-medida/generar";
import { conModulo } from "@/server/lab/a-la-medida/http";
import { guardarNegocio, reemplazarGenerados } from "@/server/lab/a-la-medida/store";

export const dynamic = "force-dynamic";

/**
 * Módulo de la agencia — la IA escribe los 8 clientes de este negocio. Cambia
 * los generados antes; los que agregó una persona se quedan.
 */
export const POST = withAuth(async (session, req: Request) =>
  conModulo(async () => {
    const body = await parseBody(req, generarSchema);
    if (!body.ok) return body.response;
    const org = session.organizationId;
    const pedido = { tipoNegocio: body.data.tipoNegocio ?? "", quienes: body.data.quienes ?? "" };
    const { tipoNegocio, clientes } = await generarClientes({ organizationId: org, ...pedido });
    const negocio = await guardarNegocio(org, {
      // Lo que escribió el dueño manda; si lo dejó vacío, lo que dedujo la IA.
      tipoNegocio: pedido.tipoNegocio || tipoNegocio,
      quienes: pedido.quienes,
      usarPropios: true,
    });
    return Response.json({ negocio, clientes: await reemplazarGenerados(org, clientes) });
  })
);
