import { withAuth } from "@/lib/api";
import type { MapaTermometro } from "@/lib/termometro";
import { termometroEnabled } from "@/server/termometro/flag";
import { leerConfig, mapa } from "@/server/termometro/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — temperatura y etiquetas de cada conversación, para la bandeja. */
export const GET = withAuth(async (session) => {
  if (!termometroEnabled()) return new Response(null, { status: 404 });
  const config = await leerConfig(session.organizationId);
  const dto: MapaTermometro = {
    activo: config.activo,
    etiquetas: config.etiquetas,
    conversaciones: config.activo ? await mapa(session.organizationId) : {},
  };
  return Response.json(dto);
});
