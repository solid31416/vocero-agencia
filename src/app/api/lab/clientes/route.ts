import { parseBody, withAuth } from "@/lib/api";
import { clienteSchema, usarSchema, type ClienteDto } from "@/lib/lab-a-la-medida";
import { PERSONAS } from "@/server/lab/personas";
import { conModulo } from "@/server/lab/a-la-medida/http";
import {
  crearCliente,
  guardarNegocio,
  leerNegocio,
  listarClientes,
} from "@/server/lab/a-la-medida/store";

export const dynamic = "force-dynamic";

/** Los de fábrica, en la misma forma, para enseñarlos al lado de los propios. */
const FABRICA: ClienteDto[] = PERSONAS.map((p) => ({
  id: p.key,
  nombre: p.label,
  tipo: p.key as ClienteDto["tipo"],
  guion: p.script,
  activo: true,
  propio: false,
}));

/** Módulo de la agencia — los clientes de prueba del negocio y los de fábrica. */
export const GET = withAuth(async (session) =>
  conModulo(async () =>
    Response.json({
      negocio: await leerNegocio(session.organizationId),
      clientes: await listarClientes(session.organizationId),
      fabrica: FABRICA,
    })
  )
);

/** Agregar un cliente escrito a mano. */
export const POST = withAuth(async (session, req: Request) =>
  conModulo(async () => {
    const body = await parseBody(req, clienteSchema);
    if (!body.ok) return body.response;
    const cliente = await crearCliente(session.organizationId, body.data);
    return Response.json({ cliente }, { status: 201 });
  })
);

/** Elegir con qué clientes corre el Laboratorio: los del negocio o los de fábrica. */
export const PATCH = withAuth(async (session, req: Request) =>
  conModulo(async () => {
    const body = await parseBody(req, usarSchema);
    if (!body.ok) return body.response;
    return Response.json({
      negocio: await guardarNegocio(session.organizationId, body.data),
    });
  })
);
