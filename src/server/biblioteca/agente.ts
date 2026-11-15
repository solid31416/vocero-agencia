import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { herramientasEfectivas } from "@/lib/agent-roles";
import { bloqueoDeEnvio, paraElAgente, type ArchivoParaAgente } from "@/lib/biblioteca";
import { SendError, sendMediaMessage } from "@/server/inbox/send";
import { guardarRespuestaDePrueba } from "@/server/lab/sandbox";
import { bibliotecaEnabled } from "./flag";
import {
  enviadosAConversacion,
  enviadosDesde,
  leerArchivo,
  leerBinario,
  listarArchivos,
  registrarEnvio,
} from "./store";

/**
 * Módulo de la agencia — lo que el agente ve y hace con la Biblioteca.
 *
 * El agente recibe la lista en el contexto del turno y pide mandar un archivo
 * por su id. Manda el CRM: el archivo sale por el mismo camino que un adjunto
 * de la bandeja (ventana de 24 h, guard del Laboratorio), marcado como de la
 * IA para que no pause al agente como si hubiera escrito una persona.
 */

async function herramientaEncendida(organizationId: string): Promise<boolean> {
  const [perfil] = await getDb()
    .select({ tools: schema.agentProfile.tools })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return herramientasEfectivas(perfil?.tools).includes("biblioteca");
}

/** La lista para el contexto; null si la biblioteca no aplica a este agente. */
export async function archivosParaElAgente(
  organizationId: string,
  conversationId: string
): Promise<ArchivoParaAgente[] | null> {
  if (!bibliotecaEnabled()) return null;
  if (!(await herramientaEncendida(organizationId))) return null;
  const [archivos, enviados] = await Promise.all([
    listarArchivos(organizationId),
    enviadosAConversacion(organizationId, conversationId),
  ]);
  return paraElAgente(archivos, enviados);
}

export type ResultadoEnvio =
  | { ok: true; messageId: string; titulo: string }
  | { ok: false; status: number; codigo: string; detalle: string };

const DIA_MS = 24 * 60 * 60 * 1000;

/** El agente manda un archivo de la biblioteca a una conversación. */
export async function enviarDelAgente(input: {
  organizationId: string;
  conversationId: string;
  archivoId: string;
  esPrueba: boolean;
}): Promise<ResultadoEnvio> {
  const { organizationId, conversationId, archivoId } = input;
  if (!(await herramientaEncendida(organizationId))) {
    return {
      ok: false,
      status: 409,
      codigo: "herramienta_apagada",
      detalle: "La herramienta «Mandar fotos y videos» está apagada en el perfil del agente",
    };
  }
  const fila = await leerArchivo(organizationId, archivoId);
  if (!fila) {
    return { ok: false, status: 404, codigo: "archivo_desconocido", detalle: "Ese archivo no está en la biblioteca" };
  }
  const hoy = await enviadosDesde(organizationId, conversationId, new Date(Date.now() - DIA_MS));
  const bloqueo = bloqueoDeEnvio({
    archivoActivo: fila.activo,
    vecesEsteArchivo: hoy.filter((id) => id === archivoId).length,
    enviosHoy: hoy.length,
  });
  if (bloqueo) return { ok: false, status: 409, ...bloqueo };

  // Laboratorio: no sale nada; queda en el hilo qué se habría mandado.
  if (input.esPrueba) {
    const guardada = await guardarRespuestaDePrueba({
      organizationId,
      conversationId,
      text: `📎 [Archivo de la biblioteca: ${fila.titulo}]`,
    });
    await registrarEnvio({ organizationId, archivoId, conversationId, messageId: guardada.messageId });
    return { ok: true, messageId: guardada.messageId, titulo: fila.titulo };
  }

  let data: Buffer;
  try {
    data = await leerBinario(organizationId, archivoId);
  } catch {
    return { ok: false, status: 410, codigo: "archivo_perdido", detalle: "El archivo ya no está en el servidor" };
  }
  try {
    const r = await sendMediaMessage({
      conversationId,
      organizationId,
      file: { data, mimeType: fila.mime, fileName: fila.nombreArchivo },
      aiGenerated: true,
    });
    await registrarEnvio({ organizationId, archivoId, conversationId, messageId: r.messageId });
    return { ok: true, messageId: r.messageId, titulo: fila.titulo };
  } catch (err) {
    if (err instanceof SendError) {
      const status = err.code === "upload_failed" || err.code === "meta_unavailable" ? 502 : 409;
      return { ok: false, status, codigo: err.code, detalle: err.message };
    }
    throw err;
  }
}
