import { z } from "zod";
import { primerNombre } from "@/lib/recordatorios";

/**
 * Módulo de la agencia (Treviño AI) — Seguimiento automático.
 *
 * Al cliente que dejó de contestar se le escribe solo a los N días de su
 * último mensaje (3, 7 y 30 por defecto). Como pasaron más de 24 h, WhatsApp
 * solo deja mandar plantillas aprobadas por Meta: cada paso lleva la suya.
 *
 * La cuenta se ancla al ÚLTIMO mensaje del cliente: si vuelve a escribir, la
 * serie se reinicia sola. Y solo corre si alguien (agente o persona) ya le
 * había contestado: un cliente sin respuesta no necesita seguimiento, necesita
 * que lo atiendan.
 *
 * Aquí viven las reglas puras (sin base ni red) para poder probarlas.
 */

export const MAX_PASOS = 3;
export const MIN_DIAS = 1;
export const MAX_DIAS = 90;
export const MAX_VARIABLES = 4;
/** Un paso que se pasó por más de esto (el revisor estuvo apagado, o se encendió el módulo con pláticas viejas) ya no sale. */
export const GRACIA_HORAS = 48;

export const pasoSchema = z.object({
  dias: z.number().int().min(MIN_DIAS).max(MAX_DIAS),
  plantillaId: z.string().trim().max(60).nullable().catch(null),
  /** Valor de cada {{n}} de la plantilla, en orden. Puede llevar {nombre}. */
  variables: z.array(z.string().trim().max(200)).max(MAX_VARIABLES).catch([]),
});
export type Paso = z.infer<typeof pasoSchema>;

export const PASOS_POR_DEFECTO: Paso[] = [
  { dias: 3, plantillaId: null, variables: ["{nombre}"] },
  { dias: 7, plantillaId: null, variables: ["{nombre}"] },
  { dias: 30, plantillaId: null, variables: ["{nombre}"] },
];

export const configSchema = z
  .object({
    activo: z.boolean().default(false),
    pasos: z.array(pasoSchema).min(1).max(MAX_PASOS).default(PASOS_POR_DEFECTO),
    /** Etapas del embudo en las que NO se le escribe (además de Ganado y Perdido, que nunca). */
    excluirEtapas: z.array(z.string().trim().max(60)).max(50).default([]),
  })
  .refine((c) => new Set(c.pasos.map((p) => p.dias)).size === c.pasos.length, {
    message: "Dos pasos no pueden caer el mismo día",
    path: ["pasos"],
  })
  .transform((c) => ({ ...c, pasos: [...c.pasos].sort((a, b) => a.dias - b.dias) }));
export type ConfigSeguimiento = z.infer<typeof configSchema>;

export const CONFIG_POR_DEFECTO: ConfigSeguimiento = configSchema.parse({});

/** Textos sugeridos para dar de alta en Plantillas (categoría Marketing), uno por paso. */
export const PLANTILLAS_SUGERIDAS: readonly string[] = [
  "Hola {{1}}, ¿pudiste revisar la información que te compartimos? Si te quedó alguna duda, con gusto te ayudo por aquí.",
  "Hola {{1}}, seguimos al pendiente de tu proyecto. ¿Te gustaría que agendemos una llamada o una visita para resolver tus dudas?",
  "Hola {{1}}, hace un tiempo platicamos sobre tu proyecto. Si todavía te interesa, contesta este mensaje y te atendemos con gusto.",
];

const DIA_MS = 86_400_000;

/** Cuándo vence el paso de `dias` para un cliente cuyo último mensaje fue `ancla`. */
export function venceEn(ancla: Date, dias: number): Date {
  return new Date(ancla.getTime() + dias * DIA_MS);
}

/**
 * Qué paso toca mandar AHORA. El más tardío que ya venció, sigue dentro de la
 * gracia y no ha salido. Así, si el revisor estuvo apagado unas horas, no
 * salen dos de golpe; y uno vencido hace semanas ya no sale.
 */
export function pasoQueToca(
  ahora: Date,
  ancla: Date,
  pasos: readonly Paso[],
  yaSalieron: readonly number[],
  graciaHoras = GRACIA_HORAS
): Paso | null {
  const t = ahora.getTime();
  const listos = pasos.filter((p) => {
    const vence = venceEn(ancla, p.dias).getTime();
    return t >= vence && t - vence <= graciaHoras * 3_600_000;
  });
  const ultimo = listos.sort((a, b) => b.dias - a.dias)[0];
  if (!ultimo || yaSalieron.includes(ultimo.dias)) return null;
  // Uno más tardío ya salió: este quedó atrás.
  if (yaSalieron.some((d) => d > ultimo.dias)) return null;
  return ultimo;
}

/** El siguiente paso que va a salir (para enseñarlo en la bandeja), o null si ya no hay. */
export function siguientePaso(
  ahora: Date,
  ancla: Date,
  pasos: readonly Paso[],
  yaSalieron: readonly number[]
): { dias: number; fecha: Date } | null {
  const mayorSalido = Math.max(0, ...yaSalieron);
  const p = [...pasos]
    .sort((a, b) => a.dias - b.dias)
    .find((x) => x.dias > mayorSalido && venceEn(ancla, x.dias).getTime() > ahora.getTime());
  return p ? { dias: p.dias, fecha: venceEn(ancla, p.dias) } : null;
}

/** Los valores de la plantilla con {nombre} ya puesto; ninguno queda vacío (Meta lo rechaza). */
export function armarVariables(variables: readonly string[], contacto: string | null | undefined): string[] {
  const nombre = primerNombre(contacto);
  return variables.map((v) => {
    const r = v.replace(/\{nombre\}/g, nombre).replace(/\s+/g, " ").trim();
    return r || "👋";
  });
}

/** «3 días», «1 día». */
export function describirDias(dias: number): string {
  return dias === 1 ? "1 día" : `${dias} días`;
}

export type EnvioDto = {
  id: string;
  conversationId: string;
  contacto: string;
  dias: number;
  estado: "enviando" | "enviado" | "omitido" | "fallido";
  detalle: string | null;
  creadoEn: string;
};

/** Lo que la bandeja enseña de una conversación. */
export type EstadoConversacionDto = {
  /** El seguimiento está encendido en Ajustes. */
  activo: boolean;
  /** Alguien lo detuvo para este cliente. */
  pausada: boolean;
  /** Por qué no corre para este cliente (null = corre). */
  motivo: string | null;
  siguiente: { dias: number; fecha: string } | null;
  enviados: EnvioDto[];
};
