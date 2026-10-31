import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Recordatorios de cita.
 *
 * El dueño elige CUÁNDO se le recuerda la cita al cliente (uno o varios
 * avisos: días, horas o minutos antes) y QUÉ se le dice. Dentro de la ventana
 * de 24 h sale su texto; fuera de ella WhatsApp solo deja mandar una plantilla
 * aprobada. Este archivo es puro: lo usan la pantalla y el servidor.
 */

export const MIN_AVISO_MIN = 5;
export const MAX_AVISO_MIN = 7 * 24 * 60;
export const MAX_AVISOS = 3;
export const MAX_TEXTO = 800;
/** Si el servidor estuvo caído, un aviso vencido aún se manda dentro de esta gracia. */
export const GRACIA_MIN = 30;

export const TEXTO_POR_DEFECTO =
  "Hola {nombre} 👋 Te recordamos tu cita el {fecha} a las {hora}.{enlace} Si necesitas cambiarla, respóndenos por aquí.";

/** La plantilla sugerida para la ventana cerrada: {{1}} nombre, {{2}} fecha, {{3}} hora. */
export const PLANTILLA_SUGERIDA =
  "Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}}. Si necesitas cambiarla, respóndenos por aquí.";

/** Lo que contesta el CRM cuando el cliente toca un botón del recordatorio. */
export const TEXTO_CONFIRMO =
  "¡Gracias por confirmar, {nombre}! Te esperamos el {fecha} a las {hora}.";
export const TEXTO_CANCELO =
  "Listo, cancelamos tu cita del {fecha} a las {hora}. Si quieres agendar otra fecha, escríbenos por aquí.";
export const TEXTO_REAGENDAR =
  "Claro, {nombre}. En un momento te ayudamos a cambiar tu cita; dinos qué día y hora te acomodan.";

const textoRespuesta = (porDefecto: string) =>
  z.string().trim().min(1, "Escribe el mensaje").max(MAX_TEXTO).default(porDefecto);

export const configSchema = z.object({
  activo: z.boolean(),
  /** Dentro de las 24 h, el recordatorio sale con los botones Confirmo / Reagendar / Cancelar. */
  botones: z.boolean().default(true),
  textoConfirmo: textoRespuesta(TEXTO_CONFIRMO),
  textoCancelo: textoRespuesta(TEXTO_CANCELO),
  textoReagendar: textoRespuesta(TEXTO_REAGENDAR),
  avisos: z
    .array(z.number().int().min(MIN_AVISO_MIN).max(MAX_AVISO_MIN))
    .max(MAX_AVISOS)
    .transform((a) => [...new Set(a)].sort((x, y) => y - x)),
  texto: z.string().trim().min(1, "Escribe el mensaje").max(MAX_TEXTO),
  plantillaId: z.string().trim().min(1).nullable(),
});
export type ConfigRecordatorios = z.infer<typeof configSchema>;

export const CONFIG_POR_DEFECTO: ConfigRecordatorios = {
  activo: false,
  avisos: [24 * 60],
  texto: TEXTO_POR_DEFECTO,
  plantillaId: null,
  botones: true,
  textoConfirmo: TEXTO_CONFIRMO,
  textoCancelo: TEXTO_CANCELO,
  textoReagendar: TEXTO_REAGENDAR,
};

/* ─────────────── Los botones del recordatorio ─────────────── */

export type AccionCita = "confirmo" | "reagendar" | "cancelo";

/** Los 3 botones, con el texto que ve el cliente (WhatsApp: máximo 20 caracteres). */
export const BOTONES_CITA: { accion: AccionCita; titulo: string }[] = [
  { accion: "confirmo", titulo: "Confirmo" },
  { accion: "reagendar", titulo: "Reagendar" },
  { accion: "cancelo", titulo: "Cancelar" },
];

const LETRA: Record<AccionCita, string> = { confirmo: "c", reagendar: "r", cancelo: "x" };
const PREFIJO_BOTON = "agcita";

/** El id que viaja en el botón y vuelve en la respuesta: «agcita:c:rec_…». */
export function idBotonCita(accion: AccionCita, envioId: string): string {
  return `${PREFIJO_BOTON}:${LETRA[accion]}:${envioId}`;
}

/** Lee el id de un botón de recordatorio; null si no es uno de los nuestros. */
export function leerBotonCita(id: string | null | undefined): { accion: AccionCita; envioId: string } | null {
  const m = /^agcita:([crx]):(rec_[a-z0-9]{1,40})$/.exec(id ?? "");
  if (!m) return null;
  const accion = (Object.keys(LETRA) as AccionCita[]).find((a) => LETRA[a] === m[1]);
  return accion ? { accion, envioId: m[2]! } : null;
}

/** Cómo queda el recordatorio con botones en el hilo de la bandeja (WhatsApp no guarda los botones como texto). */
export function textoConBotones(cuerpo: string): string {
  return `${cuerpo}\n\n${BOTONES_CITA.map((b) => `[${b.titulo}]`).join(" · ")}`;
}

/** Lo que se anota en las notas de la cita cuando el cliente toca un botón. */
export function notaDeRespuesta(accion: AccionCita, cuando: string): string {
  const que =
    accion === "confirmo" ? "✅ Confirmó" : accion === "cancelo" ? "❌ Canceló" : "🔁 Pidió reagendar";
  return `${que} por WhatsApp (${cuando}).`;
}

export type EnvioDto = {
  id: string;
  contacto: string;
  cita: string;
  minutos: number;
  estado: "enviando" | "enviado" | "omitido" | "fallido";
  detalle: string | null;
  /** Lo que contestó el cliente con los botones, si contestó. */
  respuesta: AccionCita | null;
  creadoEn: string;
};

/** «1 día antes», «2 horas antes», «30 minutos antes», «1 día y 2 horas antes». */
export function describirAviso(minutos: number): string {
  const d = Math.floor(minutos / 1440);
  const h = Math.floor((minutos % 1440) / 60);
  const m = minutos % 60;
  const partes = [
    d ? `${d} ${d === 1 ? "día" : "días"}` : null,
    h ? `${h} ${h === 1 ? "hora" : "horas"}` : null,
    m ? `${m} ${m === 1 ? "minuto" : "minutos"}` : null,
  ].filter(Boolean) as string[];
  const texto =
    partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}` : partes[0] ?? "0 minutos";
  return `${texto} antes`;
}

/** La fecha y la hora de la cita, en la zona del negocio y en español. */
export function fechaYHora(cuando: Date, zona: string): { fecha: string; hora: string } {
  const fecha = new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(cuando);
  const hora = new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    hour: "numeric",
    minute: "2-digit",
  }).format(cuando);
  return { fecha, hora };
}

export function primerNombre(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "").replace(/^\[Prueba\]\s*/, "").trim();
  if (!limpio || /^\+?\d[\d\s-]*$/.test(limpio)) return "";
  return limpio.split(/\s+/)[0] ?? "";
}

export type ValoresCita = { nombre: string; fecha: string; hora: string; enlace: string | null };

/** Rellena {nombre} {fecha} {hora} {enlace} del texto del dueño. */
export function armarTexto(plantilla: string, v: ValoresCita): string {
  return plantilla
    .replace(/\{nombre\}/g, v.nombre)
    .replace(/\{fecha\}/g, v.fecha)
    .replace(/\{hora\}/g, v.hora)
    .replace(/\{enlace\}/g, v.enlace ? ` Enlace de la reunión: ${v.enlace}` : "")
    .replace(/[ \t]{2,}/g, " ")
    // Sin nombre, «Hola , te…» queda «Hola, te…».
    .replace(/[ \t]+([,.!?])/g, "$1")
    // La hora termina en punto («10:00 a.m.») y el texto le pone otro: «a.m..» → «a.m.».
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .trim();
}

/** Los valores de la plantilla de Meta, en orden: {{1}} nombre, {{2}} fecha, {{3}} hora, {{4}} enlace. */
export function variablesPlantilla(v: ValoresCita): string[] {
  return [v.nombre || "👋", v.fecha, v.hora, v.enlace ?? "sin enlace"];
}

/**
 * Qué avisos de una cita tocan AHORA. Vence cuando llega su momento, y se
 * manda solo dentro de la gracia: una cita agendada después del momento del
 * aviso (agendó hoy para dentro de 20 minutos y el aviso es de «1 día antes»)
 * no recibe ese aviso tarde.
 */
export function avisosVencidos(
  ahora: Date,
  cita: Date,
  avisos: readonly number[],
  graciaMin = GRACIA_MIN
): number[] {
  const t = ahora.getTime();
  if (cita.getTime() <= t) return [];
  return avisos.filter((m) => {
    const vence = cita.getTime() - m * 60_000;
    return t >= vence && t - vence <= graciaMin * 60_000;
  });
}
