import { withAuth } from "@/lib/api";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { leerArchivo, leerBinario } from "@/server/biblioteca/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * El archivo, para verlo en la pantalla (miniatura, video, PDF). Acepta
 * `Range`: Safari no reproduce un video sin poder pedirlo por partes.
 */
export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const fila = await leerArchivo(session.organizationId, id);
  if (!fila) return new Response(null, { status: 404 });
  const data = await leerBinario(session.organizationId, id).catch(() => null);
  if (!data) return new Response(null, { status: 404 });

  const base = {
    "content-type": fila.mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (rango && (rango[1] || rango[2])) {
    const total = data.byteLength;
    let inicio = rango[1] ? Number(rango[1]) : total - Number(rango[2]);
    let fin = rango[1] && rango[2] ? Number(rango[2]) : total - 1;
    inicio = Math.max(0, inicio);
    fin = Math.min(total - 1, fin);
    if (inicio > fin) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    }
    const parte = data.subarray(inicio, fin + 1);
    return new Response(new Uint8Array(parte), {
      status: 206,
      headers: { ...base, "content-length": String(parte.byteLength), "content-range": `bytes ${inicio}-${fin}/${total}` },
    });
  }
  return new Response(new Uint8Array(data), {
    headers: { ...base, "content-length": String(data.byteLength) },
  });
});
