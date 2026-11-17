import { z } from "zod";

/**
 * Módulo de la agencia — la configuración de «Vendedor» (Ajustes → Ventas →
 * Vendedor). Archivo aparte, sin importar `cotizaciones.ts`, porque esa
 * configuración vive dentro de la de cotizaciones.
 */

export const LEYENDA_POR_DEFECTO =
  "Cotización preparada por nuestro asistente virtual con precios de lista; sujeta a confirmación de un asesor.";

export const vendedorSchema = z.object({
  /** El agente vende: conoce el catálogo y puede cotizar. */
  activo: z.boolean().default(false),
  /** Puede decir precios en la plática; si no, solo los da en la cotización. */
  preciosEnChat: z.boolean().default(true),
  /** «aprobar»: la deja lista y una persona la manda. «sola»: la manda él. */
  modoEnvio: z.enum(["aprobar", "sola"]).default("aprobar"),
  /** Puede poner extras del catálogo (flete, instalación). Apagado: «por confirmar». */
  extras: z.object({ activo: z.boolean().default(false) }).default({ activo: false }),
  /** Puede dar descuento, hasta este porcentaje. */
  descuento: z
    .object({ activo: z.boolean().default(false), maxPct: z.coerce.number().min(0).max(50).default(5) })
    .default({ activo: false, maxPct: 5 }),
  /** Arriba de este total, la cotización la hace una persona. */
  tope: z
    .object({ activo: z.boolean().default(true), monto: z.coerce.number().min(1).max(1e10).default(1_000_000) })
    .default({ activo: true, monto: 1_000_000 }),
  /** Más piezas (sin contar extras) que esto, la hace una persona. */
  cantidadMax: z
    .object({ activo: z.boolean().default(true), piezas: z.coerce.number().int().min(1).max(10_000).default(5) })
    .default({ activo: true, piezas: 5 }),
  /** Lo que dice el PDF cuando lo manda el agente solo. Vacío = sin leyenda. */
  leyenda: z.string().trim().max(300).default(LEYENDA_POR_DEFECTO),
  /** Vigencia de lo que manda el agente solo (más corta que la normal). */
  vigenciaDias: z.coerce.number().int().min(1).max(365).default(7),
  /** Avisar por WhatsApp al teléfono del dueño (el de Ajustes → IA → Resumen). */
  avisarWhatsapp: z.boolean().default(true),
});
export type ConfigVendedor = z.infer<typeof vendedorSchema>;
export const VENDEDOR_POR_DEFECTO: ConfigVendedor = vendedorSchema.parse({});
