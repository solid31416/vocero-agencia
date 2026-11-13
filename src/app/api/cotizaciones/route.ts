import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { cotizacionInputSchema } from "@/lib/cotizaciones";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { aDto, guardarBorrador, leerConfig, listarCotizaciones } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

/** Las cotizaciones de una conversación (o las últimas), y la lista de productos para armar una. */
export const GET = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const conversationId = new URL(req.url).searchParams.get("conversationId") ?? undefined;
  const org = session.organizationId;
  const [cotizaciones, config] = await Promise.all([
    listarCotizaciones(org, { conversationId, limite: 20 }),
    leerConfig(org),
  ]);
  return Response.json({
    cotizaciones,
    productos: config.productos,
    condiciones: {
      ivaPct: config.ivaPct,
      preciosConIva: config.preciosConIva,
      anticipoPct: config.anticipoPct,
      vigenciaDias: config.vigenciaDias,
      moneda: config.moneda,
    },
  });
});

const postSchema = cotizacionInputSchema.extend({ id: z.string().trim().max(40).nullish() });

/** Crea un borrador (o reescribe el borrador `id`). Enviar es otro paso. */
export const POST = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  const { id, ...datos } = body.data;
  const r = await guardarBorrador({
    organizationId: session.organizationId,
    id: id ?? null,
    datos: cotizacionInputSchema.parse(datos),
    creadaPor: session.userId,
  });
  if (!r.ok) return apiError(r.codigo === "no_existe" ? 404 : 409, r.codigo, r.detalle);
  return Response.json({ cotizacion: aDto(r.fila) }, { status: id ? 200 : 201 });
});
