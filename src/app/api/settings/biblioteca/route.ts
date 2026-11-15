import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { MAX_ARCHIVOS, detectarMime, metaSchema, problemaDelArchivo } from "@/lib/biblioteca";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { aDto, contarArchivos, crearArchivo, listarArchivos } from "@/server/biblioteca/store";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — los archivos de la Biblioteca. */
export const GET = withAuth(async (session) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  const archivos = await listarArchivos(session.organizationId);
  return Response.json({ archivos, puedeEditar: canConfigure(session.role), maxArchivos: MAX_ARCHIVOS });
});

/** Sube un archivo (multipart: `archivo`, `titulo`, `cuando`). */
export const POST = withAuth(async (session, req: Request) => {
  if (!bibliotecaEnabled()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien administra sube archivos");

  const form = await req.formData().catch(() => null);
  const file = form?.get("archivo");
  if (!(file instanceof File)) return apiError(422, "sin_archivo", "Elige una foto, un video o un PDF");

  const meta = metaSchema.safeParse({ titulo: form?.get("titulo") ?? "", cuando: form?.get("cuando") ?? "" });
  if (!meta.success) {
    return apiError(422, "invalido", meta.error.issues[0]?.message ?? "Revisa el título");
  }
  if ((await contarArchivos(session.organizationId)) >= MAX_ARCHIVOS) {
    return apiError(409, "lleno", `La biblioteca ya tiene ${MAX_ARCHIVOS} archivos: borra alguno para subir otro`);
  }

  const data = Buffer.from(await file.arrayBuffer());
  // El tipo real, por sus primeros bytes: no se confía en el que dice el navegador.
  const mime = detectarMime(data);
  const problema = problemaDelArchivo(mime, data.byteLength);
  if (problema || !mime) return apiError(422, "archivo", problema ?? "Archivo no válido");

  const fila = await crearArchivo({
    organizationId: session.organizationId,
    titulo: meta.data.titulo,
    cuando: meta.data.cuando,
    mime,
    nombreArchivo: file.name || "archivo",
    data,
    creadoPor: session.userId,
  });
  return Response.json({ archivo: aDto(fila) }, { status: 201 });
});
