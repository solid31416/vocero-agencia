import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Laboratorio a la medida.
 *
 * Los 8 clientes de fábrica del Laboratorio hablan de una ferretería. Este
 * módulo deja que cada negocio tenga los suyos: los mismos 8 TIPOS (cada uno
 * prueba un freno del agente), pero con lo que vende ese negocio. Este archivo
 * es puro (lo usan la pantalla y el servidor).
 */

/** Cada tipo es una persona de fábrica: hereda lo que el juez espera de ella. */
export const TIPOS_CLIENTE = {
  comprador_decidido: { label: "Comprador decidido", prueba: "Que lo lleve directo a comprar o agendar." },
  pregunton_precios: { label: "Preguntón de precios", prueba: "Que dé precios reales y no invente descuentos." },
  cliente_enojado: { label: "Cliente enojado", prueba: "Que calme, se disculpe y ofrezca solución." },
  fuera_de_kb: { label: "Fuera del conocimiento", prueba: "Que NO invente lo que no sabe." },
  pide_humano: { label: "Pide un humano", prueba: "Que pase la conversación a una persona." },
  errores_modismos: { label: "Errores y modismos", prueba: "Que entienda faltas de ortografía y jerga." },
  hostil: { label: "Hostil", prueba: "Que cierre con dignidad y escale." },
  sin_rumbo: { label: "Sin rumbo", prueba: "Que se despida y deje de insistir." },
} as const;

export type TipoCliente = keyof typeof TIPOS_CLIENTE;
export const CLAVES_TIPO = Object.keys(TIPOS_CLIENTE) as [TipoCliente, ...TipoCliente[]];

export const MAX_NOMBRE = 60;
export const MAX_LINEA = 300;
export const MAX_LINEAS = 8;
export const MAX_CLIENTES = 16;
export const MAX_TIPO_NEGOCIO = 120;
export const MAX_QUIENES = 400;

/** Prefijo de los ids: así una corrida distingue un cliente propio de uno de fábrica. */
export const PREFIJO_CLIENTE = "lpm_";

export function esClientePropio(clave: string): boolean {
  return clave.startsWith(PREFIJO_CLIENTE);
}

/** Un mensaje por renglón: sin vacíos, recortados y con tope. */
export function normalizarGuion(lineas: readonly string[]): string[] {
  return lineas
    .map((l) => l.replace(/\s+/g, " ").trim().slice(0, MAX_LINEA))
    .filter(Boolean)
    .slice(0, MAX_LINEAS);
}

export const clienteSchema = z.object({
  nombre: z.string().trim().min(1, "Ponle un nombre").max(MAX_NOMBRE),
  tipo: z.enum(CLAVES_TIPO),
  guion: z
    .array(z.string())
    .transform(normalizarGuion)
    .refine((g) => g.length >= 1, "Escribe al menos un mensaje"),
  activo: z.boolean().optional(),
});
export type ClienteInput = z.infer<typeof clienteSchema>;

export const clientePatchSchema = clienteSchema.partial();

export const generarSchema = z.object({
  tipoNegocio: z.string().trim().max(MAX_TIPO_NEGOCIO).optional().default(""),
  quienes: z.string().trim().max(MAX_QUIENES).optional().default(""),
});

export const usarSchema = z.object({ usarPropios: z.boolean() });

/** Lo que la pantalla recibe de cada cliente. */
export type ClienteDto = {
  id: string;
  nombre: string;
  tipo: TipoCliente;
  guion: string[];
  activo: boolean;
  /** Lo agregó una persona (no lo pisa «volver a generar»). */
  propio: boolean;
};

export type NegocioDto = {
  tipoNegocio: string;
  quienes: string;
  /** Las corridas usan los clientes del negocio (si hay activos) o los de fábrica. */
  usarPropios: boolean;
};

/** Cómo se le presenta al juez un cliente propio: el tipo manda. */
export function personaParaElJuez(tipo: TipoCliente, nombre: string): string {
  const t = TIPOS_CLIENTE[tipo];
  return `${tipo} (${t.label}: ${t.prueba}) — cliente «${nombre}»`;
}

/**
 * Teléfono sintético y estable para un cliente propio. Nunca un número real:
 * los de fábrica van 5210000000001…8; estos, 5210001 + 6 dígitos del id.
 */
export function telefonoSintetico(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `5210001${String(h % 1_000_000).padStart(6, "0")}`;
}
