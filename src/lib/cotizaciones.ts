import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Cotización en PDF.
 *
 * Lo compartido entre servidor y pantalla: la configuración del negocio
 * (datos, lista de productos y condiciones), las partidas de una cotización y
 * el cálculo de totales. Los precios SIEMPRE salen de aquí (de la lista o de
 * lo que escribió una persona), nunca de la IA.
 */

export const ESTADOS_COTIZACION = ["borrador", "enviada", "aceptada", "rechazada", "vencida"] as const;
export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];

export const ESTADO_INFO: Record<EstadoCotizacion, { etiqueta: string; color: string }> = {
  borrador: { etiqueta: "Borrador", color: "#8b8d98" },
  enviada: { etiqueta: "Enviada", color: "#3e8ed0" },
  aceptada: { etiqueta: "Aceptada", color: "#30a46c" },
  rechazada: { etiqueta: "Rechazada", color: "#e5484d" },
  vencida: { etiqueta: "Vencida", color: "#d6a100" },
};

export const MAX_PRODUCTOS = 200;
export const MAX_PARTIDAS = 50;
/** El logo va en la base (base64): pequeño a propósito. */
export const MAX_LOGO_BYTES = 300 * 1024;

const dinero = z.coerce.number().min(0, "El precio no puede ser negativo").max(100_000_000);

export const productoSchema = z.object({
  id: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1, "Ponle nombre al producto").max(120),
  precio: dinero,
  unidad: z.string().trim().max(20).default("pieza"),
  descripcion: z.string().trim().max(300).default(""),
});
export type Producto = z.infer<typeof productoSchema>;

export const negocioSchema = z.object({
  nombre: z.string().trim().max(120).default(""),
  rfc: z.string().trim().max(20).default(""),
  direccion: z.string().trim().max(200).default(""),
  telefono: z.string().trim().max(40).default(""),
  correo: z.string().trim().max(120).default(""),
});

export const MENSAJE_POR_DEFECTO =
  "Hola {nombre}, te comparto tu cotización {folio} por {total}. Es válida hasta el {vigencia}. Cualquier duda, aquí estamos.";

export const configSchema = z.object({
  negocio: negocioSchema.default({ nombre: "", rfc: "", direccion: "", telefono: "", correo: "" }),
  productos: z.array(productoSchema).max(MAX_PRODUCTOS, `Máximo ${MAX_PRODUCTOS} productos`).default([]),
  vigenciaDias: z.coerce.number().int().min(1).max(365).default(15),
  ivaPct: z.coerce.number().min(0).max(30).default(16),
  /** true: los precios de la lista ya traen IVA (el IVA se desglosa hacia dentro). */
  preciosConIva: z.boolean().default(false),
  anticipoPct: z.coerce.number().min(0).max(100).default(50),
  formaPago: z.string().trim().max(300).default("Transferencia o depósito bancario."),
  condiciones: z.string().trim().max(1500).default(""),
  /** El texto que acompaña al PDF en WhatsApp. {nombre} {folio} {total} {vigencia}. */
  mensaje: z.string().trim().min(1).max(600).default(MENSAJE_POR_DEFECTO),
  moneda: z.enum(["MXN", "USD"]).default("MXN"),
});
export type ConfigCotizaciones = z.infer<typeof configSchema>;
export const CONFIG_POR_DEFECTO: ConfigCotizaciones = configSchema.parse({});

export const partidaSchema = z.object({
  /** De la lista de productos, si salió de ahí. */
  productoId: z.string().trim().max(40).nullable().default(null),
  concepto: z.string().trim().min(1, "Cada partida necesita un concepto").max(200),
  descripcion: z.string().trim().max(300).default(""),
  cantidad: z.coerce.number().gt(0, "La cantidad debe ser mayor a 0").max(100_000),
  unidad: z.string().trim().max(20).default("pieza"),
  precio: dinero,
});
export type Partida = z.infer<typeof partidaSchema>;

export const MAX_CLIENTE = 120;

export const cotizacionInputSchema = z.object({
  conversationId: z.string().trim().min(1),
  partidas: z
    .array(partidaSchema)
    .min(1, "Agrega al menos una partida")
    .max(MAX_PARTIDAS, `Máximo ${MAX_PARTIDAS} partidas`),
  descuentoPct: z.coerce.number().min(0).max(100).default(0),
  notas: z.string().trim().max(1000).default(""),
  /**
   * A nombre de quién sale (PDF y mensaje). Vacío = el nombre del contacto,
   * que suele ser el de su perfil de WhatsApp («J», un apodo, un emoji).
   */
  cliente: z.string().trim().max(MAX_CLIENTE).default(""),
});
export type CotizacionInput = z.infer<typeof cotizacionInputSchema>;

export type Totales = {
  subtotal: number;
  descuento: number;
  base: number;
  iva: number;
  total: number;
  anticipo: number;
};

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Totales de una cotización. Con `preciosConIva` el total es la suma ya con
 * IVA y el IVA se desglosa hacia dentro; si no, el IVA se suma encima.
 */
export function calcularTotales(
  partidas: Pick<Partida, "cantidad" | "precio">[],
  opciones: { descuentoPct: number; ivaPct: number; preciosConIva: boolean; anticipoPct: number }
): Totales {
  const bruto = centavos(partidas.reduce((s, p) => s + p.cantidad * p.precio, 0));
  const descuento = centavos((bruto * opciones.descuentoPct) / 100);
  const neto = centavos(bruto - descuento);
  const tasa = opciones.ivaPct / 100;
  let base: number;
  let iva: number;
  let total: number;
  if (opciones.preciosConIva) {
    total = neto;
    base = centavos(neto / (1 + tasa));
    iva = centavos(total - base);
  } else {
    base = neto;
    iva = centavos(base * tasa);
    total = centavos(base + iva);
  }
  return {
    subtotal: bruto,
    descuento,
    base,
    iva,
    total,
    anticipo: centavos((total * opciones.anticipoPct) / 100),
  };
}

export function formatoDinero(n: number, moneda: "MXN" | "USD" = "MXN"): string {
  const s = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return moneda === "USD" ? `US$${s}` : `$${s}`;
}

export function folioDe(numero: number): string {
  return `COT-${String(numero).padStart(4, "0")}`;
}

/** Fecha corta en español en la zona del negocio: «27 de noviembre de 2026». */
export function fechaLarga(d: Date, zona = "America/Mexico_City"): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: zona }).format(d);
}

/** El texto que acompaña al PDF, con sus variables llenas. */
export function armarMensaje(
  plantilla: string,
  datos: { nombre: string; folio: string; total: string; vigencia: string }
): string {
  const primerNombre = datos.nombre.trim().split(/\s+/)[0] ?? "";
  return plantilla
    .replaceAll("{nombre}", primerNombre)
    .replaceAll("{folio}", datos.folio)
    .replaceAll("{total}", datos.total)
    .replaceAll("{vigencia}", datos.vigencia)
    .replace(/\s+,/g, ",")
    .replace(/Hola ,/g, "Hola,")
    .trim();
}

/**
 * Lo que dice el pedido que nace de una cotización: sus partidas en una
 * línea («2 × Domo Estándar, Instalación»), del largo que cabe en el pedido.
 */
export function conceptoDeCotizacion(partidas: readonly Pick<Partida, "concepto" | "cantidad">[]): string {
  return partidas
    .filter((p) => p.concepto.trim())
    .map((p) => (p.cantidad === 1 ? p.concepto.trim() : `${p.cantidad} × ${p.concepto.trim()}`))
    .join(", ")
    .slice(0, 300);
}

/** Se acepta lo que ya se mandó (aunque haya vencido: el cliente puede decir que sí tarde). */
export function sePuedeAceptar(estado: EstadoCotizacion): boolean {
  return estado === "enviada" || estado === "vencida";
}

/** Una enviada cuya vigencia ya pasó se ve como vencida (sin revisor de fondo). */
export function estadoVisible(estado: EstadoCotizacion, venceEn: Date | null, ahora = new Date()): EstadoCotizacion {
  if (estado === "enviada" && venceEn && venceEn.getTime() < ahora.getTime()) return "vencida";
  return estado;
}

export type CotizacionDto = {
  id: string;
  folio: string;
  conversationId: string | null;
  contactoNombre: string;
  estado: EstadoCotizacion;
  partidas: Partida[];
  descuentoPct: number;
  notas: string;
  totales: Totales;
  moneda: "MXN" | "USD";
  venceEn: string | null;
  enviadaEn: string | null;
  createdAt: string;
};

/** Lo que la IA propone a partir de la plática: solo productos y cantidades. */
/**
 * Lo que se le pide a la IA en «Que la IA la llene». Las notas salen
 * IMPRESAS en el PDF que recibe el cliente: son aclaraciones para él sobre lo
 * que cubre la cotización, nunca un resumen de la plática para el vendedor
 * (con «resume los detalles» la IA metía «pidió fotos», «quiere llamada»,
 * su ánimo…). Las condiciones fijas (pago, vigencia) viven en Ajustes.
 */
export const PROMPT_SUGERENCIA = [
  "Armas el BORRADOR de una cotización a partir de una conversación de WhatsApp entre un negocio y su cliente.",
  "Devuelve SOLO JSON con esta forma:",
  '{"cliente":"nombre del cliente, o vacío","partidas":[{"productoId":"id de la lista o null","concepto":"nombre del producto o servicio","cantidad":1}],"notas":"aclaraciones para el cliente, o vacío"}',
  "Regla del cliente: el nombre con el que el cliente SE PRESENTÓ en la plática (nombre y apellido si los dio; si habla por una empresa, «Nombre — Empresa»). No uses su nombre de perfil ni lo inventes: si no lo dijo, deja cliente vacío.",
  "Reglas de las partidas:",
  "- Usa productos de la LISTA siempre que se pueda (copia su id exacto).",
  "- Si el cliente pidió algo que no está en la lista, ponlo con productoId null y un concepto claro.",
  "- La cantidad sale de lo que dijo el cliente; si no la dijo, 1.",
  "- NUNCA incluyas precios, descuentos ni totales.",
  "- Si no hay nada que cotizar, devuelve partidas vacío.",
  "Reglas de las notas (van IMPRESAS en la cotización que recibe el CLIENTE):",
  "- Escríbelas PARA EL CLIENTE, en tono profesional, de 1 a 3 frases.",
  "- Solo aclara lo que cubre o supone esta cotización: lugar de entrega o instalación, modelo o medidas elegidas, fecha deseada, y lo que corre por cuenta del cliente que haya salido en la plática (por ejemplo nivelar el terreno o dar acceso).",
  "- NUNCA pongas nada interno: ni resumen de la conversación, ni su ánimo o urgencia, ni lo que le pidió al vendedor (llamadas, fotos, visitas), ni etapas, temperatura, cotizaciones anteriores o su nombre de pila.",
  "- No inventes condiciones ni plazos que no salieron en la plática. Si no hay nada que aclarar, deja notas vacío.",
  'Ejemplo de notas correctas: "Incluye entrega e instalación en Dr. Arroyo, N.L. No incluye la preparación del terreno, que corre por cuenta del cliente."',
  'Ejemplo de notas INCORRECTAS (son para el vendedor): "El cliente pidió fotos y que le llamen; tiene prisa."',
].join("\n");

export const sugerenciaIaSchema = z.object({
  partidas: z
    .array(
      z.object({
        productoId: z.string().nullable().catch(null),
        concepto: z.string().catch(""),
        cantidad: z.coerce.number().catch(1),
      })
    )
    .max(MAX_PARTIDAS)
    .catch([]),
  notas: z.string().max(1000).catch(""),
  cliente: z.string().max(MAX_CLIENTE).catch(""),
});
export type SugerenciaIa = z.infer<typeof sugerenciaIaSchema>;

/**
 * Convierte lo que propuso la IA en partidas con el precio de la LISTA. Lo que
 * no está en la lista queda en $0 y marcado «sin precio» para que una persona
 * lo llene: la IA jamás pone precios.
 */
export function partidasDeSugerencia(
  sugerencia: SugerenciaIa,
  productos: Producto[]
): { partidas: Partida[]; sinPrecio: number } {
  let sinPrecio = 0;
  const partidas: Partida[] = [];
  for (const s of sugerencia.partidas) {
    const cantidad = Number.isFinite(s.cantidad) && s.cantidad > 0 ? Math.min(s.cantidad, 100_000) : 1;
    const p =
      productos.find((x) => x.id === s.productoId) ??
      productos.find((x) => normalizar(x.nombre) === normalizar(s.concepto));
    if (p) {
      partidas.push({
        productoId: p.id,
        concepto: p.nombre,
        descripcion: p.descripcion,
        cantidad,
        unidad: p.unidad,
        precio: p.precio,
      });
    } else if (s.concepto.trim()) {
      sinPrecio++;
      partidas.push({
        productoId: null,
        concepto: s.concepto.trim().slice(0, 200),
        descripcion: "sin precio: llénalo antes de enviar",
        cantidad,
        unidad: "pieza",
        precio: 0,
      });
    }
  }
  return { partidas, sinPrecio };
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
