import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { MAX_LOGO_BYTES } from "@/lib/cotizaciones";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { guardarLogo, leerLogo } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

const TIPOS = new Set(["image/png", "image/jpeg"]);

/** El logo que va arriba en el PDF (PNG o JPG, hasta 300 KB). */
export const GET = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const logo = await leerLogo(session.organizationId);
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: { "content-type": logo.mime, "cache-control": "private, no-store" },
  });
});

export const POST = withAuth(async (session, req: Request) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia el logo");
  const form = await req.formData().catch(() => null);
  const archivo = form?.get("logo");
  if (!(archivo instanceof File)) return apiError(422, "sin_archivo", "Elige una imagen PNG o JPG");
  if (!TIPOS.has(archivo.type)) return apiError(422, "tipo", "El logo debe ser PNG o JPG");
  if (archivo.size > MAX_LOGO_BYTES) return apiError(422, "pesado", "El logo pesa más de 300 KB");
  const data = Buffer.from(await archivo.arrayBuffer());
  // Que sea de verdad PNG/JPG (no confiar solo en el tipo que manda el navegador).
  const esPng = data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const esJpg = data[0] === 0xff && data[1] === 0xd8;
  if (!(esPng || esJpg)) return apiError(422, "tipo", "El archivo no es una imagen PNG o JPG válida");
  await guardarLogo(session.organizationId, { data, mime: esPng ? "image/png" : "image/jpeg" });
  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (session) => {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra cambia el logo");
  await guardarLogo(session.organizationId, null);
  return Response.json({ ok: true });
});
