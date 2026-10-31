import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Resumen para quien atiende.
 *
 * Cuando el agente le pasa una conversación a una persona (o alguien pausa la
 * IA a mano), el CRM arma un resumen corto con la IA: quién es, qué quiere,
 * qué ya se le dijo, qué falta y cómo viene. Se ve arriba del chat en la
 * bandeja y, si el dueño quiere, le llega por WhatsApp. Al cliente nunca.
 * Este archivo es puro: lo usan la pantalla y el servidor.
 */

/** Cuántos mensajes recientes lee la IA, y cuánto de cada uno. */
export const MAX_MENSAJES = 40;
export const MAX_CARACTERES_MENSAJE = 500;
const MAX_CAMPO = 300;

const campo = z
  .string()
  .trim()
  .transform((s) => s.slice(0, MAX_CAMPO))
  .catch("");

/** Lo que contesta la IA. Tolerante: un campo raro queda vacío, no tumba el resumen. */
export const resumenSchema = z.object({
  quien: campo,
  quiere: campo,
  yaSeDijo: campo,
  falta: campo,
  animo: campo,
});
export type Resumen = z.infer<typeof resumenSchema>;

/** Los renglones del resumen, en el orden en que se muestran. */
export const RENGLONES: { campo: keyof Resumen; titulo: string }[] = [
  { campo: "quien", titulo: "Quién" },
  { campo: "quiere", titulo: "Qué quiere" },
  { campo: "yaSeDijo", titulo: "Ya se le dijo" },
  { campo: "falta", titulo: "Falta" },
  { campo: "animo", titulo: "Ánimo" },
];

export const configSchema = z.object({
  activo: z.boolean().default(true),
  /** Además de la bandeja, avisarle al dueño por WhatsApp cuando el agente pasa una conversación. */
  avisarDueno: z.boolean().default(false),
  telefonoDueno: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s === "" || (s.length >= 10 && s.length <= 15), "Escribe el teléfono con lada (10 a 15 dígitos)")
    .transform((s) => s || null)
    .nullable()
    .default(null),
});
export type ConfigResumen = z.infer<typeof configSchema>;
export const CONFIG_POR_DEFECTO: ConfigResumen = { activo: true, avisarDueno: false, telefonoDueno: null };

/** El motivo del traspaso (los del CRM, más «manual»), dicho para personas. */
export const MOTIVO_TEXTO: Record<string, string> = {
  cliente: "El cliente pidió hablar con una persona",
  modelo: "El agente decidió pasarla a una persona",
  error: "El agente tuvo un problema y la pasó",
  ventana: "Se cerró la ventana de 24 h",
  hostilidad: "El cliente se molestó",
  manual: "Una persona pausó la IA",
  pedido: "Se pidió desde la bandeja (la IA sigue contestando)",
};

export function textoMotivo(motivo: string | null | undefined): string {
  return MOTIVO_TEXTO[motivo ?? ""] ?? "Se pasó a una persona";
}

export type ResumenDto = {
  resumen: Resumen;
  motivo: string;
  generadoEn: string;
};

export type MensajeParaResumen = {
  quien: "cliente" | "agente" | "persona";
  texto: string;
};

const ETIQUETA: Record<MensajeParaResumen["quien"], string> = {
  cliente: "CLIENTE",
  agente: "AGENTE (IA)",
  persona: "EQUIPO",
};

/** El texto de un mensaje para la IA; los adjuntos sin texto se nombran. */
export function textoDeMensaje(tipo: string, texto: string | null): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (limpio) return limpio.slice(0, MAX_CARACTERES_MENSAJE);
  const NOMBRES: Record<string, string> = {
    image: "[imagen]",
    video: "[video]",
    audio: "[nota de voz]",
    document: "[documento]",
    sticker: "[sticker]",
    location: "[ubicación]",
    contacts: "[contacto]",
  };
  return NOMBRES[tipo] ?? "[mensaje sin texto]";
}

export function armarPrompt(input: {
  nombreContacto: string;
  ficha: Record<string, unknown> | null;
  motivo: string;
  mensajes: MensajeParaResumen[];
}): { system: string; user: string } {
  const system = [
    "Eres el asistente de un equipo de atención por WhatsApp. Una persona del equipo va a tomar",
    "esta conversación y necesita entenderla en 10 segundos. Escribe en español de México, frases",
    "cortas, sin inventar nada que no esté en la conversación. Si un dato no aparece, escribe «—».",
    "Contesta SOLO un JSON con estas llaves (cada valor, una o dos frases):",
    '{"quien": "quién es el cliente (nombre y lo que se sepa: negocio, si es nuevo o ya era cliente)",',
    ' "quiere": "qué busca o qué problema tiene",',
    ' "yaSeDijo": "lo importante que ya se le contestó o prometió (precios, horarios, citas)",',
    ' "falta": "qué tiene que hacer ahora la persona del equipo",',
    ' "animo": "cómo viene el cliente: interesado, con prisa, molesto, indeciso…"}',
  ].join("\n");
  const ficha =
    input.ficha && Object.keys(input.ficha).length
      ? `\nFicha del contacto: ${JSON.stringify(input.ficha).slice(0, 1500)}`
      : "";
  const hilo = input.mensajes
    .slice(-MAX_MENSAJES)
    .map((m) => `${ETIQUETA[m.quien]}: ${m.texto}`)
    .join("\n");
  const user = [
    `Contacto: ${input.nombreContacto || "sin nombre"}${ficha}`,
    `Por qué se pasa a una persona: ${textoMotivo(input.motivo)}`,
    "",
    "Conversación (de la más vieja a la más reciente):",
    hilo || "(sin mensajes)",
  ].join("\n");
  return { system, user };
}

/** El aviso corto que le llega al dueño por WhatsApp. */
export function textoAviso(input: { nombreContacto: string; resumen: Resumen; motivo: string; enlace: string }): string {
  const r = input.resumen;
  const lineas = [
    `🙋 ${input.nombreContacto || "Un cliente"} necesita a una persona`,
    textoMotivo(input.motivo) + ".",
    r.quiere && r.quiere !== "—" ? `Quiere: ${r.quiere}` : null,
    r.falta && r.falta !== "—" ? `Falta: ${r.falta}` : null,
    `Ábrela aquí: ${input.enlace}`,
  ].filter(Boolean);
  return lineas.join("\n");
}
