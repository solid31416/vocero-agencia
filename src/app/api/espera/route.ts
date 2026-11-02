import { withAuth } from "@/lib/api";
import type { MapaEspera } from "@/lib/espera-humano";
import { esperaEnabled } from "@/server/espera-humano/flag";
import { mapaEspera } from "@/server/espera-humano/revisar";
import { leerConfig } from "@/server/espera-humano/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — quién espera a una persona y desde cuándo, para la bandeja. */
export const GET = withAuth(async (session) => {
  if (!esperaEnabled()) return new Response(null, { status: 404 });
  const config = await leerConfig(session.organizationId);
  const dto: MapaEspera = {
    activo: config.activo,
    minutosDueno: config.minutosDueno,
    conversaciones: config.activo ? await mapaEspera(session.organizationId) : {},
  };
  return Response.json(dto);
});
