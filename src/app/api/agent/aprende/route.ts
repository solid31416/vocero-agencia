import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { configSchema, type AprendeDto, type ConfigAprende } from "@/lib/aprende-traspasos";
import { aprendeEnabled } from "@/server/aprende-traspasos/flag";
import { contar, guardarConfig, leerConfig, listarPendientes } from "@/server/aprende-traspasos/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — «Nea aprende de sus traspasos»: lo que hay que revisar. */
export const GET = withAuth(async (session) => {
  if (!aprendeEnabled()) return new Response(null, { status: 404 });
  const org = session.organizationId;
  const [config, pendientes, cuentas] = await Promise.all([leerConfig(org), listarPendientes(org), contar(org)]);
  const dto: AprendeDto = { config, pendientes, ...cuentas };
  return Response.json({ ...dto, puedeEditar: canConfigure(session.role) });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!aprendeEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra cambia esto");
  }
  const body = await parseBody(req, configSchema);
  if (!body.ok) return body.response;
  const c: ConfigAprende = configSchema.parse(body.data);
  return Response.json({ config: await guardarConfig(session.organizationId, c) });
});
