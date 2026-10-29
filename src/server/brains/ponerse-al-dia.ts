import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Módulo de la agencia (Treviño AI) — Ponerse al día.
 *
 * El despacho solo lleva la ráfaga del cliente; lo que pasó mientras la IA
 * estaba en pausa (lo que escribió una persona del equipo desde la bandeja, y
 * lo que el cliente dijo y nadie le despachó al cerebro) no le llegaba: al
 * reactivar la IA, el agente contestaba sin saber de qué se había hablado.
 *
 * Con la bandera `PONER_AL_DIA_AL_AGENTE`, el evento lleva además
 * `ponerseAlDia`: los mensajes posteriores a la última respuesta del agente,
 * fuera de la ráfaga. Apagada por defecto (ADR-001). La clave solo viaja
 * cuando hay algo, al final del evento: el cuerpo gemelo del contrato no
 * cambia, y un cerebro que no la conoce la ignora (lee un diccionario).
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parsePonerAlDiaFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function ponerAlDiaEnabled(): boolean {
  return parsePonerAlDiaFlag(process.env.PONER_AL_DIA_AL_AGENTE);
}

/** Un mensaje del «mientras tanto», tal como viaja en el evento. */
export type MensajeAlDia = {
  id: string;
  at: string;
  /** Quién lo dijo: el cliente, o alguien del negocio que no es el agente. */
  de: "cliente" | "equipo";
  texto: string;
};

/** Cuántos mensajes como máximo, y cuánto de cada uno. */
export const MAX_AL_DIA = 20;
export const MAX_TEXTO_AL_DIA = 1000;
/** Cuántos mensajes hacia atrás se mira para encontrar al agente. */
const VENTANA = 60;

export type FilaAlDia = {
  id: string;
  direction: string;
  aiGenerated: boolean;
  type: string;
  text: string | null;
  caption: string | null;
  createdAt: Date;
};

/**
 * Pura. `ordenados` va del más viejo al más nuevo. Devuelve lo posterior a la
 * última respuesta del agente, sin lo que ya viaja en la ráfaga (`excluir`),
 * con los más recientes si hay de más.
 */
export function seleccionarAlDia(
  ordenados: readonly FilaAlDia[],
  excluir: readonly string[]
): MensajeAlDia[] {
  const ultimaDelAgente = ordenados.reduce(
    (idx, m, i) => (m.direction === "out" && m.aiGenerated ? i : idx),
    -1
  );
  const fuera = new Set(excluir);
  const seleccion = ordenados
    .slice(ultimaDelAgente + 1)
    .filter((m) => !fuera.has(m.id))
    .map((m): MensajeAlDia | null => {
      const texto = (m.text ?? m.caption ?? "").trim() || etiquetaDeTipo(m.type);
      if (!texto) return null;
      return {
        id: m.id,
        at: m.createdAt.toISOString(),
        de: m.direction === "in" ? "cliente" : "equipo",
        texto:
          texto.length > MAX_TEXTO_AL_DIA
            ? `${texto.slice(0, MAX_TEXTO_AL_DIA)}…`
            : texto,
      };
    })
    .filter((m): m is MensajeAlDia => m !== null);
  return seleccion.slice(-MAX_AL_DIA);
}

/** Un adjunto sin texto también es parte de la conversación. */
function etiquetaDeTipo(type: string): string {
  switch (type) {
    case "image":
      return "[envió una imagen]";
    case "audio":
      return "[envió una nota de voz]";
    case "video":
      return "[envió un video]";
    case "document":
      return "[envió un documento]";
    case "sticker":
      return "[envió un sticker]";
    case "location":
      return "[envió una ubicación]";
    case "contacts":
      return "[envió un contacto]";
    default:
      return "";
  }
}

/** Lee de la base lo que pasó desde la última respuesta del agente. */
export async function ponerseAlDiaDe(
  organizationId: string,
  conversationId: string,
  excluir: readonly string[]
): Promise<MensajeAlDia[]> {
  const db = getDb();
  const filas = await db
    .select({
      id: schema.message.id,
      direction: schema.message.direction,
      aiGenerated: schema.message.aiGenerated,
      type: schema.message.type,
      text: schema.message.text,
      caption: schema.mediaAsset.caption,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.mediaAsset.id, schema.message.mediaAssetId)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(VENTANA);
  return seleccionarAlDia(filas.slice().reverse(), excluir);
}
