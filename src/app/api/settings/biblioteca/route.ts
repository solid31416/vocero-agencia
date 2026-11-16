import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import {
  MAX_ARCHIVOS,
  MAX_PARTES,
  detectarMime,
  metaSchema,
  problemaDelArchivo,
  problemaDelLote,
} from "@/lib/biblioteca";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { aDto, contarArchivos, crearArchivo, listarArchivos } from "@/server/biblioteca/store";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { leerConfig } from "@/server/cotizaciones/store";

export const dynamic = "force-dynamic";

/**
 * Los nombres de la lista de productos de Cotizaciones, para elegir el título
 * con un clic. Sin el módulo (o si falla), la lista va vacía y se escribe a mano.
 */
async function nombresDeProductos(organizationId: string): Promise<string[]> {
  if (!cotizacionesEnabled()) return [];
  try {
    const config = await leerConfig(organizationId);
    return [...new Set(config.productos.map((p) => p.nombre.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Módulo de la agencia — los archivos de la Biblioteca. */
export const GET = withAuth(async (session) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  const [archivos, productos] = await Promise.all([
    listarArchivos(session.organizationId),
    nombresDeProductos(session.organizationId),
  ]);
  return Response.json({
    archivos,
    productos,
    puedeEditar: canConfigure(session.role),
    maxArchivos: MAX_ARCHIVOS,
    maxPartes: MAX_PARTES,
  });
});

/**
 * Sube un producto (multipart: `titulo`, `cuando` y uno o varios `archivo`).
 * Varias fotos del mismo producto quedan como UN archivo de la biblioteca:
 * el agente las manda juntas.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra sube archivos");

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("archivo") ?? []).filter((f): f is File => f instanceof File);
  const lote = problemaDelLote(files.map((f) => f.size));
  if (lote) return apiError(422, files.length === 0 ? "sin_archivo" : "archivo", lote);

  const meta = metaSchema.safeParse({ titulo: form?.get("titulo") ?? "", cuando: form?.get("cuando") ?? "" });
  if (!meta.success) {
    return apiError(422, "invalido", meta.error.issues[0]?.message ?? "Revisa el título");
  }
  if ((await contarArchivos(session.organizationId)) >= MAX_ARCHIVOS) {
    return apiError(409, "lleno", `La biblioteca ya tiene ${MAX_ARCHIVOS} archivos: borra alguno para subir otro`);
  }

  const partes: { mime: string; nombreArchivo: string; data: Buffer }[] = [];
  for (const file of files) {
    const data = Buffer.from(await file.arrayBuffer());
    // El tipo real, por sus primeros bytes: no se confía en el que dice el navegador.
    const mime = detectarMime(data);
    const problema = problemaDelArchivo(mime, data.byteLength);
    if (problema || !mime) {
      const quien = files.length > 1 ? `«${file.name || "archivo"}»: ` : "";
      return apiError(422, "archivo", quien + (problema ?? "Archivo no válido"));
    }
    partes.push({ mime, nombreArchivo: file.name || "archivo", data });
  }

  const { fila, extras } = await crearArchivo({
    organizationId: session.organizationId,
    titulo: meta.data.titulo,
    cuando: meta.data.cuando,
    partes,
    creadoPor: session.userId,
  });
  return Response.json({ archivo: aDto(fila, 0, extras) }, { status: 201 });
});
