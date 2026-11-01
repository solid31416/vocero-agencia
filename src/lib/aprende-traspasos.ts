import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Nea aprende de sus traspasos.
 *
 * Cuando el agente pasa una conversación a una persona y esa persona contesta
 * desde la bandeja, lo que la persona dijo suele ser justo lo que al agente le
 * faltaba saber (un precio, un horario, una política). Al cerrar ese traspaso
 * la IA lee la plática y propone preguntas y respuestas nuevas para el
 * conocimiento. Nada entra solo: el dueño las revisa, las edita y las aprueba
 * en la pantalla Agente. Este archivo es puro: lo usan la pantalla y el servidor.
 */

/** Cuántas sugerencias puede sacar de un traspaso, y cuántos mensajes lee. */
export const MAX_SUGERENCIAS = 3;
export const MAX_MENSAJES = 40;
/** Mensajes de antes del traspaso que se leen para entender de qué se hablaba. */
export const CONTEXTO_PREVIO = 10;
export const MAX_CARACTERES_MENSAJE = 500;
/** Cuánto del conocimiento actual se le pasa a la IA para que no repita. */
export const MAX_CARACTERES_CONOCIMIENTO = 6000;

/** Sin mensajes nuevos en este tiempo, el traspaso se da por atendido. */
export const SILENCIO_PARA_ANALIZAR_MS = 2 * 60 * 60 * 1000;
/** Un traspaso que nadie contestó en este tiempo se cierra sin analizar. */
export const VENCE_SIN_RESPUESTA_MS = 7 * 24 * 60 * 60 * 1000;

export const LIMITE_PREGUNTA = 500;
export const LIMITE_RESPUESTA = 4000;

const texto = (max: number) =>
  z
    .string()
    .trim()
    .transform((s) => s.slice(0, max))
    .catch("");

/** Una sugerencia tal como la manda la IA. Tolerante: lo raro queda vacío. */
export const sugerenciaIaSchema = z.object({
  pregunta: texto(LIMITE_PREGUNTA),
  respuesta: texto(LIMITE_RESPUESTA),
  porque: texto(300),
});
export type SugerenciaIa = z.infer<typeof sugerenciaIaSchema>;

/** Lo que contesta la IA: una lista (vacía si no hay nada que aprender). */
export const respuestaIaSchema = z.object({
  sugerencias: z.array(z.unknown()).catch([]),
});

/** Limpia la respuesta de la IA: quita vacías, repetidas y las que ya están en el conocimiento. */
export function limpiarSugerencias(crudas: unknown[], preguntasExistentes: string[]): SugerenciaIa[] {
  const vistas = [...preguntasExistentes];
  const salida: SugerenciaIa[] = [];
  for (const cruda of crudas) {
    const r = sugerenciaIaSchema.safeParse(cruda);
    if (!r.success) continue;
    const s = r.data;
    if (s.pregunta.length < 5 || s.respuesta.length < 2) continue;
    if (s.respuesta === "—" || s.pregunta === "—") continue;
    if (vistas.some((v) => sonParecidas(v, s.pregunta))) continue;
    vistas.push(s.pregunta);
    salida.push(s);
    if (salida.length >= MAX_SUGERENCIAS) break;
  }
  return salida;
}

const VACIAS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "y", "o", "que",
  "qué", "por", "para", "con", "se", "su", "sus", "es", "son", "mi", "me", "tu", "te", "lo", "le", "hay",
  "cual", "cuál", "como", "cómo", "cuanto", "cuánto", "cuanta", "cuánta", "tienen", "tiene", "ustedes",
]);

/** Palabras con significado de una pregunta, sin acentos ni signos. */
export function palabrasClave(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 2 && !VACIAS.has(p));
}

/** Dos preguntas que comparten casi todas sus palabras clave cuentan como la misma. */
export function sonParecidas(a: string, b: string): boolean {
  const pa = new Set(palabrasClave(a));
  const pb = new Set(palabrasClave(b));
  if (pa.size === 0 || pb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let comunes = 0;
  for (const p of pa) if (pb.has(p)) comunes++;
  return comunes / Math.min(pa.size, pb.size) >= 0.8;
}

export type QuienHabla = "cliente" | "agente" | "persona";
export type MensajeParaAprender = { quien: QuienHabla; texto: string; despuesDelTraspaso: boolean };

const ETIQUETA: Record<QuienHabla, string> = {
  cliente: "CLIENTE",
  agente: "AGENTE (IA)",
  persona: "EQUIPO",
};

/** Quién escribió un mensaje: entrante = cliente; saliente de la IA = agente; el resto, una persona. */
export function quienHabla(m: { direction: string; origin: string; aiGenerated: boolean }): QuienHabla | null {
  if (m.direction === "in") return "cliente";
  if (m.aiGenerated || m.origin === "ai") return "agente";
  if (m.origin === "operator" || m.origin === "manual") return "persona";
  return null; // plantillas: no son una persona contestando
}

/** El texto de un mensaje para la IA; los adjuntos sin texto se nombran. */
export function textoDeMensaje(tipo: string, t: string | null): string {
  const limpio = (t ?? "").replace(/\s+/g, " ").trim();
  if (limpio) return limpio.slice(0, MAX_CARACTERES_MENSAJE);
  return tipo === "audio" ? "[nota de voz]" : tipo === "image" ? "[imagen]" : `[${tipo}]`;
}

export function armarPrompt(input: {
  nombreNegocio: string;
  conocimiento: { pregunta: string; respuesta: string }[];
  bloques: string[];
  mensajes: MensajeParaAprender[];
}): { system: string; user: string } {
  const system = [
    `Ayudas a mejorar el conocimiento de un agente de IA que atiende por WhatsApp a los clientes de «${input.nombreNegocio || "un negocio"}».`,
    "El agente pasó esta conversación a una persona del EQUIPO, y la persona la atendió.",
    "Tu trabajo: encontrar datos DEL NEGOCIO que la persona del EQUIPO le dio al cliente y que el agente",
    "no sabía, para que la próxima vez el agente los conteste solo.",
    "",
    "Reglas:",
    "- Solo datos que dijo el EQUIPO, generales y que sirvan para otros clientes: precios, horarios, servicios,",
    "  formas de pago, políticas, tiempos, ubicaciones, requisitos.",
    "- NO: datos personales del cliente, cosas de este caso nada más («tu pedido sale mañana»), saludos,",
    "  promesas sueltas, ni nada que el agente ya tenga en su conocimiento (te lo paso abajo).",
    "- No inventes ni completes: si el EQUIPO no lo dijo claro, no lo pongas.",
    "- La pregunta, como la haría cualquier cliente (sin nombres). La respuesta, con la voz del negocio,",
    "  corta y lista para usarse tal cual.",
    `- Máximo ${MAX_SUGERENCIAS}. Si no hay nada que valga la pena, lista vacía (es lo normal).`,
    "",
    'Contesta SOLO un JSON: {"sugerencias": [{"pregunta": "...", "respuesta": "...", "porque": "qué no supo el agente, en una frase"}]}',
  ].join("\n");

  let disponible = MAX_CARACTERES_CONOCIMIENTO;
  const lineasKb: string[] = [];
  for (const q of input.conocimiento) {
    const l = `- P: ${q.pregunta} / R: ${q.respuesta}`;
    if (l.length > disponible) break;
    lineasKb.push(l);
    disponible -= l.length;
  }
  for (const b of input.bloques) {
    if (disponible <= 0) break;
    const l = `- ${b.replace(/\s+/g, " ").slice(0, disponible)}`;
    lineasKb.push(l);
    disponible -= l.length;
  }

  const hilo = input.mensajes.slice(-MAX_MENSAJES);
  const indiceTraspaso = hilo.findIndex((m) => m.despuesDelTraspaso);
  const lineas = hilo.map((m, i) => {
    const marca = i === indiceTraspaso ? "--- (aquí el agente pasó la conversación a una persona) ---\n" : "";
    return `${marca}${ETIQUETA[m.quien]}: ${m.texto}`;
  });

  const user = [
    "Conocimiento que el agente YA tiene:",
    lineasKb.length ? lineasKb.join("\n") : "(vacío)",
    "",
    "Conversación (de la más vieja a la más reciente):",
    lineas.join("\n") || "(sin mensajes)",
  ].join("\n");
  return { system, user };
}

/** ¿Ya se puede analizar este traspaso? Puro, para probarlo sin base. */
export type Decision = "esperar" | "analizar" | "vencido";

export function decidir(input: {
  desde: Date;
  ahora: Date;
  /** ¿La IA ya se reactivó en esa conversación? */
  iaReactivada: boolean;
  /** ¿Una persona contestó desde el traspaso? */
  personaRespondio: boolean;
  ultimoMensajeEn: Date | null;
  /** El botón «Buscar ahora»: no espera el silencio. */
  forzar?: boolean;
}): Decision {
  const edad = input.ahora.getTime() - input.desde.getTime();
  if (!input.personaRespondio) return edad > VENCE_SIN_RESPUESTA_MS ? "vencido" : "esperar";
  if (input.forzar || input.iaReactivada) return "analizar";
  const ultimo = input.ultimoMensajeEn ?? input.desde;
  return input.ahora.getTime() - ultimo.getTime() >= SILENCIO_PARA_ANALIZAR_MS ? "analizar" : "esperar";
}

export const configSchema = z.object({
  activo: z.boolean().default(true),
});
export type ConfigAprende = z.infer<typeof configSchema>;
export const CONFIG_POR_DEFECTO: ConfigAprende = { activo: true };

export type SugerenciaDto = {
  id: string;
  conversationId: string;
  nombreContacto: string;
  pregunta: string;
  respuesta: string;
  porque: string;
  estado: "pendiente" | "aprobada" | "descartada";
  creadoEn: string;
};

export type AprendeDto = {
  config: ConfigAprende;
  pendientes: SugerenciaDto[];
  /** Traspasos que esperan a que una persona termine de atenderlos. */
  enEspera: number;
  aprobadas: number;
  descartadas: number;
};
