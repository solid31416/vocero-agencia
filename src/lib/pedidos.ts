import { z } from "zod";
import { primerNombre } from "@/lib/recordatorios";

/**
 * Módulo de la agencia (Treviño AI) — Estado del pedido.
 *
 * Cada pedido avanza por las etapas que define el negocio (fabricación, en
 * camino, aduana, instalación…). Al moverlo, se le puede avisar al cliente
 * por WhatsApp con el texto de esa etapa; con la ventana de 24 h cerrada, con
 * una plantilla aprobada. Y el estado queda en la ficha del contacto, que el
 * agente lee: si el cliente pregunta «¿cómo va mi pedido?», ya lo sabe.
 *
 * Aquí viven las reglas puras (sin base ni red) para poder probarlas.
 */

export const MIN_ETAPAS = 2;
export const MAX_ETAPAS = 12;
export const MAX_MENSAJE = 600;
export const MAX_VARIABLES = 3;

export const etapaSchema = z.object({
  id: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1).max(40),
  /** Lo que se le dice al cliente al llegar a esta etapa. Vacío = no se avisa. */
  mensaje: z.string().trim().max(MAX_MENSAJE).catch(""),
});
export type Etapa = z.infer<typeof etapaSchema>;

export const ETAPAS_POR_DEFECTO: Etapa[] = [
  {
    id: "confirmado",
    nombre: "Pedido confirmado",
    mensaje: "Hola {nombre}, confirmamos tu pedido {folio}. Te iremos avisando por aquí cada avance.",
  },
  {
    id: "fabricacion",
    nombre: "En fabricación",
    mensaje: "{nombre}, tu pedido {folio} ya está en fabricación. Entrega estimada: {fecha}.",
  },
  { id: "en-camino", nombre: "En camino", mensaje: "¡Buenas noticias, {nombre}! Tu pedido {folio} ya va en camino." },
  {
    id: "aduana",
    nombre: "En aduana",
    mensaje:
      "{nombre}, tu pedido {folio} está en revisión de aduana. Es un paso normal; te avisamos en cuanto salga.",
  },
  {
    id: "entregado",
    nombre: "Entregado",
    mensaje: "{nombre}, tu pedido {folio} ya fue entregado. ¡Gracias por tu confianza!",
  },
  {
    id: "instalado",
    nombre: "Instalado",
    mensaje: "{nombre}, tu pedido {folio} quedó instalado. Cualquier duda, aquí estamos para ayudarte.",
  },
];

export const configSchema = z
  .object({
    etapas: z.array(etapaSchema).min(MIN_ETAPAS).max(MAX_ETAPAS).default(ETAPAS_POR_DEFECTO),
    /** Para avisar con la ventana de 24 h cerrada: {{1}} nombre, {{2}} folio, {{3}} etapa. */
    plantillaId: z.string().trim().max(60).nullable().default(null),
    /** Anotar el estado en la ficha del contacto (el agente la lee). */
    actualizarFicha: z.boolean().default(true),
  })
  .refine((c) => new Set(c.etapas.map((e) => e.id)).size === c.etapas.length, {
    message: "Dos etapas no pueden tener la misma clave",
    path: ["etapas"],
  });
export type ConfigPedidos = z.infer<typeof configSchema>;

export const CONFIG_POR_DEFECTO: ConfigPedidos = configSchema.parse({});

export const PLANTILLA_SUGERIDA =
  "Hola {{1}}, te compartimos el avance de tu pedido {{2}}: ahora está «{{3}}». Si tienes alguna duda, responde este mensaje.";

/** Una clave estable a partir del nombre («En aduana» → «en-aduana»). */
export function claveDeEtapa(nombre: string, usadas: readonly string[] = []): string {
  const base =
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "etapa";
  let clave = base;
  for (let i = 2; usadas.includes(clave); i++) clave = `${base}-${i}`;
  return clave;
}

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD")
  .nullable();

export const pedidoInputSchema = z.object({
  conversationId: z.string().trim().min(1).max(60),
  concepto: z.string().trim().min(1, "Escribe qué se pidió").max(300),
  monto: z.number().min(0).max(1e10).nullable().default(null),
  fechaEstimada: fechaSchema.default(null),
  notas: z.string().trim().max(1000).default(""),
  cotizacionId: z.string().trim().max(60).nullable().default(null),
  /** Avisarle al cliente que su pedido quedó confirmado (la primera etapa). */
  avisar: z.boolean().default(true),
});
export type PedidoInput = z.infer<typeof pedidoInputSchema>;

export const cambioSchema = z.object({
  etapaId: z.string().trim().min(1).max(40).optional(),
  nota: z.string().trim().max(500).default(""),
  avisar: z.boolean().default(true),
  /** El texto que va al cliente, si quien lo mueve lo editó. */
  mensaje: z.string().trim().max(MAX_MENSAJE).optional(),
  concepto: z.string().trim().min(1).max(300).optional(),
  monto: z.number().min(0).max(1e10).nullable().optional(),
  fechaEstimada: fechaSchema.optional(),
});
export type Cambio = z.infer<typeof cambioSchema>;

export type AvisoHistorial = "texto" | "plantilla" | "no" | "fallo";

export type Movimiento = {
  etapaId: string;
  etapaNombre: string;
  en: string;
  nota: string;
  aviso: AvisoHistorial;
  detalle: string | null;
  por: string | null;
};

export type PedidoDto = {
  id: string;
  folio: string;
  conversationId: string | null;
  contactoNombre: string;
  concepto: string;
  monto: number | null;
  fechaEstimada: string | null;
  etapaId: string;
  etapaNombre: string;
  /** Posición de la etapa (0 = la primera); -1 si ya no existe en los ajustes. */
  etapaIndice: number;
  totalEtapas: number;
  historial: Movimiento[];
  cotizacionId: string | null;
  notas: string;
  creadoEn: string;
  actualizadoEn: string;
};

export function folioDe(numero: number): string {
  return `PED-${String(numero).padStart(4, "0")}`;
}

/** «2026-11-20» → «20 de noviembre de 2026» (sin moverse de día por la zona horaria). */
export function fechaLegible(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return "";
  return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Rellena {nombre} {folio} {estado} {fecha} {concepto}; lo que queda vacío no deja huecos raros. */
export function armarMensaje(
  plantilla: string,
  v: { contacto: string; folio: string; estado: string; fechaEstimada: string | null; concepto: string }
): string {
  const fecha = fechaLegible(v.fechaEstimada) || "por confirmar";
  return plantilla
    .replace(/\{nombre\}/g, primerNombre(v.contacto))
    .replace(/\{folio\}/g, v.folio)
    .replace(/\{estado\}/g, v.estado)
    .replace(/\{fecha\}/g, fecha)
    .replace(/\{concepto\}/g, v.concepto)
    .replace(/^\s*,\s*/, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Los valores de la plantilla ({{1}} nombre, {{2}} folio, {{3}} etapa); ninguno vacío. */
export function variablesPlantilla(contacto: string, folio: string, estado: string): string[] {
  return [primerNombre(contacto) || "👋", folio, estado];
}

/** Lo que se anota en la ficha del contacto para que el agente lo lea. */
export function resumenParaFicha(p: {
  folio: string;
  concepto: string;
  etapaNombre: string;
  fechaEstimada: string | null;
  esUltima: boolean;
}): string {
  const partes = [p.folio, p.concepto.slice(0, 120), `estado: ${p.etapaNombre}`];
  if (p.fechaEstimada && !p.esUltima) partes.push(`entrega estimada: ${fechaLegible(p.fechaEstimada)}`);
  return partes.join(" · ");
}

/** La posición de la etapa en los ajustes (para la barra de avance). */
export function indiceDeEtapa(etapas: readonly Etapa[], etapaId: string): number {
  return etapas.findIndex((e) => e.id === etapaId);
}
