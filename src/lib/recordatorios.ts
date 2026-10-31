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

export const configSchema = z.object({
  activo: z.boolean(),
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
};

export type EnvioDto = {
  id: string;
  contacto: string;
  cita: string;
  minutos: number;
  estado: "enviando" | "enviado" | "omitido" | "fallido";
  detalle: string | null;
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
