import { withAuth } from "@/lib/api";
import { tandaAprende } from "@/server/aprende-traspasos/analizar";
import { aprendeEnabled } from "@/server/aprende-traspasos/flag";

export const dynamic = "force-dynamic";

/**
 * Módulo de la agencia — «Buscar ahora»: analiza ya los traspasos en los que
 * una persona contestó, sin esperar a que la plática se calme.
 */
export const POST = withAuth(async (session) => {
  if (!aprendeEnabled()) return new Response(null, { status: 404 });
  const r = await tandaAprende({ organizationId: session.organizationId, forzar: true });
  return Response.json(r);
});
