import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Termómetro del cliente.
 *
 * La IA lee cada conversación cuando se calma y le pone una temperatura
 * (caliente / tibia / fría: qué tan cerca está de comprar) y hasta 3
 * etiquetas de una lista que el dueño personaliza. La bandeja las muestra y
 * deja filtrar por ellas; quien atiende puede corregirlas a mano (y entonces
 * la IA ya no las toca). Este archivo es puro: lo usan la pantalla y el servidor.
 */

export const TEMPERATURAS = ["caliente", "tibia", "fria"] as const;
export type Temperatura = (typeof TEMPERATURAS)[number];

export const TEMPERATURA_INFO: Record<Temperatura, { etiqueta: string; emoji: string; criterio: string; color: string }> = {
  caliente: {
    etiqueta: "Caliente",
    emoji: "🔥",
    criterio: "Listo para comprar o agendar: pidió precio final, forma de pago, disponibilidad, o dijo que lo quiere.",
    color: "#e5484d",
  },
  tibia: {
    etiqueta: "Tibio",
    emoji: "🌤️",
    criterio: "Interesado pero sin decidir: pregunta detalles, compara o dice que lo va a pensar.",
    color: "#f5a524",
  },
  fria: {
    etiqueta: "Frío",
    emoji: "❄️",
    criterio: "Solo curiosea, no contesta, no le interesa, o escribió por otra cosa (queja, proveedor, número equivocado).",
    color: "#3e8ed0",
  },
};

/** Los colores que se pueden elegir para una etiqueta. */
export const COLORES = {
  rojo: "#e5484d",
  naranja: "#f76b15",
  amarillo: "#d6a100",
  verde: "#30a46c",
  azul: "#3e8ed0",
  morado: "#8e4ec6",
  rosa: "#d6409f",
  gris: "#8b8d98",
} as const;
export type Color = keyof typeof COLORES;
export const NOMBRES_COLORES = Object.keys(COLORES) as Color[];

export const MAX_ETIQUETAS = 12;
export const MAX_ETIQUETAS_POR_CONVERSACION = 3;
export const MAX_MENSAJES = 20;
export const MAX_CARACTERES_MENSAJE = 400;
/** Se espera a que la plática se calme antes de clasificar (no a media ráfaga). */
export const CALMA_MS = 2 * 60 * 1000;
/** Conversaciones sin mensajes en este tiempo ya no se clasifican solas. */
export const VENTANA_MS = 7 * 24 * 60 * 60 * 1000;

/** El id de una etiqueta: su nombre sin acentos ni signos. */
export function idDeEtiqueta(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const etiquetaSchema = z.object({
  id: z.string().optional(),
  nombre: z.string().trim().min(1, "Ponle nombre a la etiqueta").max(30),
  descripcion: z.string().trim().max(200).default(""),
  color: z.enum(NOMBRES_COLORES as [Color, ...Color[]]).catch("gris"),
});
export type Etiqueta = { id: string; nombre: string; descripcion: string; color: Color };

export const ETIQUETAS_POR_DEFECTO: Etiqueta[] = [
  { id: "cotizacion", nombre: "Cotización", descripcion: "Pidió precio o una cotización", color: "azul" },
  { id: "quiere-cita", nombre: "Quiere cita", descripcion: "Quiere agendar, visitar o una llamada", color: "verde" },
  { id: "queja", nombre: "Queja", descripcion: "Está molesto o reporta un problema", color: "rojo" },
  { id: "ya-es-cliente", nombre: "Ya es cliente", descripcion: "Ya compró antes o tiene un servicio activo", color: "morado" },
  { id: "solo-pregunta", nombre: "Solo pregunta", descripcion: "Dudas generales, sin intención clara de comprar", color: "gris" },
];

export const configSchema = z
  .object({
    activo: z.boolean().default(true),
    /** Qué es un cliente «caliente» para este negocio, en palabras del dueño (opcional). */
    criterio: z.string().trim().max(500).default(""),
    etiquetas: z.array(etiquetaSchema).max(MAX_ETIQUETAS, `Máximo ${MAX_ETIQUETAS} etiquetas`).default(ETIQUETAS_POR_DEFECTO),
  })
  .transform((c) => {
    // El id sale del nombre; dos con el mismo nombre se quedan en una.
    const vistas = new Set<string>();
    const etiquetas: Etiqueta[] = [];
    for (const e of c.etiquetas) {
      const id = idDeEtiqueta(e.nombre) || "etiqueta";
      if (vistas.has(id)) continue;
      vistas.add(id);
      etiquetas.push({ id, nombre: e.nombre, descripcion: e.descripcion ?? "", color: e.color });
    }
    return { activo: c.activo, criterio: c.criterio, etiquetas };
  });
export type ConfigTermometro = { activo: boolean; criterio: string; etiquetas: Etiqueta[] };
export const CONFIG_POR_DEFECTO: ConfigTermometro = { activo: true, criterio: "", etiquetas: ETIQUETAS_POR_DEFECTO };

/** Lo que contesta la IA. Tolerante: lo raro queda vacío y se limpia después. */
export const respuestaIaSchema = z.object({
  temperatura: z.string().catch(""),
  etiquetas: z.array(z.unknown()).catch([]),
  razon: z
    .string()
    .trim()
    .transform((s) => s.slice(0, 200))
    .catch(""),
});

export type Clasificacion = { temperatura: Temperatura | null; etiquetas: string[]; razon: string };

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Limpia la respuesta de la IA contra las etiquetas que existen (acepta id o nombre). */
export function limpiarClasificacion(cruda: unknown, etiquetas: Etiqueta[]): Clasificacion {
  const r = respuestaIaSchema.safeParse(cruda);
  if (!r.success) return { temperatura: null, etiquetas: [], razon: "" };
  const t = normalizar(r.data.temperatura);
  const temperatura: Temperatura | null =
    t.startsWith("calient") ? "caliente" : t.startsWith("tibi") ? "tibia" : t.startsWith("fri") ? "fria" : null;
  const ids: string[] = [];
  for (const x of r.data.etiquetas) {
    if (typeof x !== "string") continue;
    const n = normalizar(x);
    const e = etiquetas.find((et) => et.id === n || normalizar(et.nombre) === n || et.id === idDeEtiqueta(x));
    if (e && !ids.includes(e.id)) ids.push(e.id);
    if (ids.length >= MAX_ETIQUETAS_POR_CONVERSACION) break;
  }
  return { temperatura, etiquetas: ids, razon: r.data.razon };
}

export type MensajeParaClasificar = { quien: "cliente" | "negocio"; texto: string };

export function textoDeMensaje(tipo: string, t: string | null): string {
  const limpio = (t ?? "").replace(/\s+/g, " ").trim();
  if (limpio) return limpio.slice(0, MAX_CARACTERES_MENSAJE);
  return tipo === "audio" ? "[nota de voz]" : tipo === "image" ? "[imagen]" : `[${tipo}]`;
}

export function armarPrompt(input: {
  nombreNegocio: string;
  config: ConfigTermometro;
  mensajes: MensajeParaClasificar[];
}): { system: string; user: string } {
  const temps = TEMPERATURAS.map((k) => {
    const extra = k === "caliente" && input.config.criterio ? ` Para este negocio: ${input.config.criterio}` : "";
    return `- "${k}": ${TEMPERATURA_INFO[k].criterio}${extra}`;
  }).join("\n");
  const etiquetas = input.config.etiquetas.length
    ? input.config.etiquetas.map((e) => `- "${e.id}" (${e.nombre})${e.descripcion ? `: ${e.descripcion}` : ""}`).join("\n")
    : "(no hay etiquetas: deja la lista vacía)";
  const system = [
    `Clasificas conversaciones de WhatsApp de los clientes de «${input.nombreNegocio || "un negocio"}».`,
    "Lee la conversación y decide qué tan cerca está el cliente de comprar o agendar, y qué etiquetas le quedan.",
    "",
    "Temperatura (elige UNA):",
    temps,
    "",
    `Etiquetas (de 0 a ${MAX_ETIQUETAS_POR_CONVERSACION}, SOLO de esta lista, usa el id entre comillas):`,
    etiquetas,
    "",
    "Fíjate sobre todo en lo más reciente: un cliente puede enfriarse o calentarse.",
    'Contesta SOLO un JSON: {"temperatura": "caliente|tibia|fria", "etiquetas": ["id", ...], "razon": "por qué, en una frase corta"}',
  ].join("\n");
  const hilo = input.mensajes
    .slice(-MAX_MENSAJES)
    .map((m) => `${m.quien === "cliente" ? "CLIENTE" : "NEGOCIO"}: ${m.texto}`)
    .join("\n");
  const user = ["Conversación (de la más vieja a la más reciente):", hilo || "(sin mensajes)"].join("\n");
  return { system, user };
}

/** ¿Toca clasificar esta conversación? Puro, para probarlo sin base. */
export function debeClasificar(input: {
  ultimoMensajeEn: Date | null;
  clasificadoEn: Date | null;
  manual: boolean;
  ahora: Date;
  /** El botón «Clasificar ahora»: no espera la calma. */
  forzar?: boolean;
}): boolean {
  if (input.manual || !input.ultimoMensajeEn) return false;
  const desdeUltimo = input.ahora.getTime() - input.ultimoMensajeEn.getTime();
  if (desdeUltimo > VENTANA_MS) return false;
  if (!input.forzar && desdeUltimo < CALMA_MS) return false;
  return !input.clasificadoEn || input.clasificadoEn.getTime() < input.ultimoMensajeEn.getTime();
}

export const manualSchema = z.object({
  temperatura: z.enum(TEMPERATURAS).nullable(),
  etiquetas: z.array(z.string().max(40)).max(MAX_ETIQUETAS_POR_CONVERSACION),
});

export type TermometroDto = {
  temperatura: Temperatura | null;
  etiquetas: string[];
  razon: string;
  manual: boolean;
  actualizadoEn: string;
};

export type MapaTermometro = {
  activo: boolean;
  etiquetas: Etiqueta[];
  conversaciones: Record<string, TermometroDto>;
};
