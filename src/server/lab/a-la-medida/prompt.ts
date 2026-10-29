import { z } from "zod";
import {
  MAX_NOMBRE,
  MAX_TIPO_NEGOCIO,
  TIPOS_CLIENTE,
  normalizarGuion,
  type ClienteInput,
  type TipoCliente,
} from "@/lib/lab-a-la-medida";

/**
 * Módulo de la agencia — el prompt que escribe los clientes de prueba de un
 * negocio, y la limpieza de lo que contesta el modelo. Puro (sin base ni red).
 */

/** Marcador del prompt (como el del juez): lo reconoce el ai-mock si algún día se prueba. */
export const MARCADOR_CLIENTES = "[CLIENTES_LAB]";

/** Cómo se porta cada tipo: lo mismo que hacen los guiones de fábrica. */
const COMO_SE_PORTA: Record<TipoCliente, string> = {
  comprador_decidido:
    "Sabe lo que quiere y va directo: saluda, pregunta por un producto o servicio que SÍ está en el conocimiento, pregunta el precio y pide comprar, contratar o agendar.",
  pregunton_precios:
    "Pregunta precio tras precio de cosas que SÍ están en el conocimiento, pide descuento y al final dice que lo va a pensar.",
  cliente_enojado:
    "Llega molesto por un problema creíble con algo que compró o un servicio que recibió en ese negocio. Exige solución, sin insultos.",
  fuera_de_kb:
    "Pregunta cosas razonables para ese tipo de negocio que NO aparecen en el conocimiento (políticas, servicios que no se mencionan, formas de pago…).",
  pide_humano:
    "Tiene un asunto delicado y pide de forma explícita hablar con una persona, no con un bot.",
  errores_modismos:
    "Escribe con faltas de ortografía, abreviaturas y modismos mexicanos (ke, x, pa, orita), sobre lo que vende ese negocio.",
  hostil:
    "Insulta de forma sostenida (estafa, bots chafas, no sirven) sin groserías extremas ni discriminación.",
  sin_rumbo:
    "Solo manda relleno sin pedir nada: «Hola», «ok», «jaja», «👍», «ok gracias», «sale».",
};

export const respuestaModeloSchema = z.object({
  tipoNegocio: z.string().optional(),
  clientes: z.array(
    z.object({
      tipo: z.string(),
      nombre: z.string().optional(),
      guion: z.array(z.string()),
    })
  ),
});
export type RespuestaModelo = z.infer<typeof respuestaModeloSchema>;

const MAX_CONOCIMIENTO = 8000;
const MAX_INSTRUCCIONES = 3000;

function recortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max)}\n[…recortado]` : texto;
}

export function armarPromptClientes(input: {
  tipos: readonly TipoCliente[];
  tipoNegocio: string;
  quienes: string;
  nombreAgente: string;
  instrucciones: string;
  conocimiento: string;
  /** Al pedir «otro guion»: lo que ya tenía, para no repetirlo. */
  evitar?: readonly string[];
}): { system: string; user: string } {
  const system = [
    `${MARCADOR_CLIENTES} Escribes guiones de clientes SIMULADOS para probar al asistente de WhatsApp de un negocio. Cada guion es la lista de mensajes que ese cliente le manda, en orden; el asistente contesta entre uno y otro.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"tipoNegocio":"en pocas palabras, qué negocio es","clientes":[{"tipo":"<clave>","nombre":"descripción corta del cliente","guion":["mensaje 1","mensaje 2"]}]}',
    "Reglas:",
    "- UN cliente por cada tipo pedido, con su clave exacta en `tipo`.",
    "- Español de México, como escribe la gente en WhatsApp: mensajes cortos, de 3 a 6 por cliente.",
    "- Habla de lo que vende ESE negocio, según su conocimiento. Nada de ferreterías ni de otros giros.",
    "- Solo escribes lo que dice el cliente. Nunca las respuestas del asistente.",
    "- `nombre` describe al cliente sin datos reales (por ejemplo «Ana, dueña de una estética»). Nunca teléfonos, correos ni nombres de personas reales.",
    "- Si el tipo de negocio viene vacío, dedúcelo del conocimiento y las instrucciones.",
  ].join("\n");

  const tipos = input.tipos
    .map((t) => `- ${t} (${TIPOS_CLIENTE[t].label}): ${COMO_SE_PORTA[t]}`)
    .join("\n");

  const user = [
    `TIPO DE NEGOCIO: ${input.tipoNegocio || "(no lo dijo: dedúcelo)"}`,
    input.quienes ? `QUIÉNES LE ESCRIBEN: ${input.quienes}` : null,
    `NOMBRE DEL ASISTENTE: ${input.nombreAgente}`,
    `INSTRUCCIONES DEL ASISTENTE:\n${recortar(input.instrucciones || "(sin instrucciones)", MAX_INSTRUCCIONES)}`,
    `CONOCIMIENTO DEL NEGOCIO:\n${recortar(input.conocimiento || "(vacío)", MAX_CONOCIMIENTO)}`,
    `TIPOS DE CLIENTE A ESCRIBIR:\n${tipos}`,
    input.evitar?.length
      ? `NO repitas este guion, escribe uno distinto:\n${input.evitar.map((l) => `- ${l}`).join("\n")}`
      : null,
    "Responde el JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

/**
 * Se queda con UN cliente por tipo pedido, en el orden pedido, limpio. Lo que
 * no sirve (tipo inventado, guion de menos de 2 mensajes) se descarta.
 */
export function depurarClientes(
  respuesta: RespuestaModelo,
  tipos: readonly TipoCliente[]
): { tipoNegocio: string; clientes: ClienteInput[] } {
  const clientes: ClienteInput[] = [];
  for (const tipo of tipos) {
    const crudo = respuesta.clientes.find((c) => c.tipo.trim() === tipo);
    if (!crudo) continue;
    const guion = normalizarGuion(crudo.guion.filter((l) => typeof l === "string"));
    if (guion.length < 2) continue;
    const nombre = (crudo.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOMBRE);
    clientes.push({ tipo, nombre: nombre || TIPOS_CLIENTE[tipo].label, guion });
  }
  return {
    tipoNegocio: (respuesta.tipoNegocio ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TIPO_NEGOCIO),
    clientes,
  };
}
