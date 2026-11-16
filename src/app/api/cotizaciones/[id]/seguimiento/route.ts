import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { descartarSenal, pausarSeguimiento, recordarAhora } from "@/server/cotizaciones/revisor";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schemaAccion = z.object({
  accion: z.enum(["pausar", "reanudar", "ahora", "descartar_senal"]),
});

/**
 * Módulo de la agencia — el seguimiento de UNA cotización: detenerlo,
 * reanudarlo, mandar el recordatorio ahora, o descartar la señal de «sí»
 * cuando no lo era.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const body = await parseBody(req, schemaAccion);
  if (!body.ok) return body.response;
  const org = session.organizationId;
  switch (body.data.accion) {
    case "pausar":
    case "reanudar": {
      const ok = await pausarSeguimiento(org, id, body.data.accion === "pausar");
      return ok ? Response.json({ ok: true }) : apiError(404, "not_found", "Cotización no encontrada");
    }
    case "descartar_senal": {
      const ok = await descartarSenal(org, id);
      return ok ? Response.json({ ok: true }) : apiError(404, "not_found", "Cotización no encontrada");
    }
    case "ahora": {
      const r = await recordarAhora(org, id);
      return r.ok ? Response.json({ ok: true, detalle: r.detalle }) : apiError(r.status, "no_salio", r.detalle);
    }
  }
});
