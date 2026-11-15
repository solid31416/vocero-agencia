import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Biblioteca de fotos, videos y fichas.
 *
 * El dueño sube archivos (con un título y cuándo mandarlos) y el agente los
 * manda por WhatsApp cuando el cliente quiere ver algo. Puro y sin servidor:
 * lo usan la API, la pantalla de Ajustes y las pruebas.
 *
 * Los límites son los de WhatsApp para enviar (foto 5 MB, video 16 MB); al
 * PDF se le pone uno más bajo que el de Meta para no llenar el disco.
 */

export type TipoArchivo = "foto" | "video" | "documento";

type Formato = { tipo: TipoArchivo; maxBytes: number; etiqueta: string };

const MB = 1024 * 1024;

export const FORMATOS: Record<string, Formato> = {
  "image/jpeg": { tipo: "foto", maxBytes: 5 * MB, etiqueta: "5 MB" },
  "image/png": { tipo: "foto", maxBytes: 5 * MB, etiqueta: "5 MB" },
  "video/mp4": { tipo: "video", maxBytes: 16 * MB, etiqueta: "16 MB" },
  "application/pdf": { tipo: "documento", maxBytes: 20 * MB, etiqueta: "20 MB" },
};

/** Lo que acepta el selector de archivos de la pantalla. */
export const ACEPTA = ".jpg,.jpeg,.png,.mp4,.pdf,image/jpeg,image/png,video/mp4,application/pdf";

export const MAX_TITULO = 80;
export const MAX_CUANDO = 300;
/** Cuántos archivos puede tener la biblioteca de un negocio. */
export const MAX_ARCHIVOS = 60;
/** Cuántos archivos puede mandar el agente en una conversación en 24 horas. */
export const MAX_ENVIOS_POR_DIA = 6;
/**
 * Veces que un MISMO archivo puede salir a una conversación en 24 h: la
 * primera y un reenvío cuando el cliente lo pide («no me llegó», «mándamela
 * otra vez»). Con 1, el agente le contestaba «el sistema no me deja».
 */
export const MAX_VECES_POR_ARCHIVO = 2;

export type ArchivoDto = {
  id: string;
  titulo: string;
  cuando: string;
  tipo: TipoArchivo;
  mime: string;
  nombreArchivo: string;
  tamano: number;
  activo: boolean;
  envios: number;
  creadoEn: string;
};

/** Lo que recibe el agente en el contexto del turno. */
export type ArchivoParaAgente = {
  id: string;
  titulo: string;
  cuando: string;
  tipo: TipoArchivo;
  yaEnviado: boolean;
};

export const metaSchema = z.object({
  titulo: z.string().trim().min(1, "Ponle un título").max(MAX_TITULO, `El título es de máximo ${MAX_TITULO} caracteres`),
  cuando: z.string().trim().max(MAX_CUANDO, `Máximo ${MAX_CUANDO} caracteres`).default(""),
});

export const cambioSchema = z.object({
  titulo: metaSchema.shape.titulo.optional(),
  cuando: z.string().trim().max(MAX_CUANDO).optional(),
  activo: z.boolean().optional(),
});

/**
 * El tipo real del archivo por sus primeros bytes. No se confía en lo que
 * dice el navegador: un archivo renombrado a .jpg no es una foto.
 */
export function detectarMime(data: Uint8Array): string | null {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 5 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 && data[4] === 0x2d) {
    return "application/pdf";
  }
  // MP4 (y MOV, que WhatsApp no acepta): «ftyp» en el byte 4.
  if (data.length >= 12 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    const marca = String.fromCharCode(data[8]!, data[9]!, data[10]!, data[11]!);
    return marca === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

/** Qué tiene de malo el archivo, en palabras del dueño; null si sirve. */
export function problemaDelArchivo(mime: string | null, tamano: number): string | null {
  if (!mime) return "Ese tipo de archivo no se puede mandar por WhatsApp. Sube una foto JPG o PNG, un video MP4 o un PDF.";
  if (mime === "video/quicktime") {
    return "Ese video es .MOV (de iPhone). WhatsApp solo acepta MP4: conviértelo a MP4 y vuelve a subirlo.";
  }
  const formato = FORMATOS[mime];
  if (!formato) return "Ese tipo de archivo no se puede mandar por WhatsApp. Sube una foto JPG o PNG, un video MP4 o un PDF.";
  if (tamano <= 0) return "El archivo está vacío.";
  if (tamano > formato.maxBytes) {
    const tipo = formato.tipo === "foto" ? "La foto" : formato.tipo === "video" ? "El video" : "El PDF";
    return `${tipo} pesa ${pesoLegible(tamano)}; el máximo es ${formato.etiqueta}.`;
  }
  return null;
}

export function tipoDe(mime: string): TipoArchivo {
  return FORMATOS[mime]?.tipo ?? "documento";
}

export function pesoLegible(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * La lista que viaja al agente: solo los activos, con lo que necesita para
 * elegir (título y cuándo) y si ya se mandó en esta conversación.
 */
export function paraElAgente(
  archivos: readonly Pick<ArchivoDto, "id" | "titulo" | "cuando" | "tipo" | "activo">[],
  yaEnviados: ReadonlySet<string>
): ArchivoParaAgente[] {
  return archivos
    .filter((a) => a.activo)
    .map((a) => ({
      id: a.id,
      titulo: a.titulo,
      cuando: a.cuando,
      tipo: a.tipo,
      yaEnviado: yaEnviados.has(a.id),
    }));
}

/** Por qué el agente no puede mandar este archivo ahora; null si puede. */
export function bloqueoDeEnvio(input: {
  archivoActivo: boolean;
  /** Cuántas veces salió ESTE archivo a esta conversación en las últimas 24 h. */
  vecesEsteArchivo: number;
  enviosHoy: number;
}): { codigo: "archivo_apagado" | "ya_enviado" | "limite"; detalle: string } | null {
  if (!input.archivoActivo) {
    return { codigo: "archivo_apagado", detalle: "Ese archivo está apagado en la biblioteca" };
  }
  if (input.vecesEsteArchivo >= MAX_VECES_POR_ARCHIVO) {
    return {
      codigo: "ya_enviado",
      detalle: `Ese archivo ya se le mandó ${input.vecesEsteArchivo} veces hoy; dile que está arriba en el chat y ofrécele pasarlo con una persona si no lo ve`,
    };
  }
  if (input.enviosHoy >= MAX_ENVIOS_POR_DIA) {
    return {
      codigo: "limite",
      detalle: `Ya se le mandaron ${MAX_ENVIOS_POR_DIA} archivos hoy a este cliente; ofrécele pasarle más con una persona`,
    };
  }
  return null;
}
