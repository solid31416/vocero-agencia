import { withAuth } from "@/lib/api";
import { tandaTermometro } from "@/server/termometro/clasificar";
import { termometroEnabled } from "@/server/termometro/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — «Clasificar ahora»: no espera a que las pláticas se calmen. */
export const POST = withAuth(async (session) => {
  if (!termometroEnabled()) return new Response(null, { status: 404 });
  return Response.json(await tandaTermometro({ organizationId: session.organizationId, forzar: true }));
});
