import { withAuth } from "@/lib/api";
import { generarClientes } from "@/server/lab/a-la-medida/generar";
import { conModulo } from "@/server/lab/a-la-medida/http";
import {
  ClienteLabError,
  editarCliente,
  leerNegocio,
  listarClientes,
} from "@/server/lab/a-la-medida/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Módulo de la agencia — «Otro guion»: la IA reescribe ESTE cliente, distinto. */
export const POST = withAuth(async (session, _req: Request, ctx: Params) =>
  conModulo(async () => {
    const { id } = await ctx.params;
    const org = session.organizationId;
    const actual = (await listarClientes(org)).find((c) => c.id === id);
    if (!actual) throw new ClienteLabError(404, "not_found", "Ese cliente de prueba ya no existe");
    const negocio = await leerNegocio(org);
    const { clientes } = await generarClientes({
      organizationId: org,
      tipoNegocio: negocio?.tipoNegocio ?? "",
      quienes: negocio?.quienes ?? "",
      tipos: [actual.tipo],
      evitar: actual.guion,
    });
    const nuevo = clientes[0]!;
    return Response.json({
      cliente: await editarCliente(org, id, { nombre: nuevo.nombre, guion: nuevo.guion }),
    });
  })
);
