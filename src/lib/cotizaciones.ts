import { z } from "zod";
import { VENDEDOR_POR_DEFECTO, vendedorSchema } from "./vendedor-config";

/**
 * Módulo de la agencia (Treviño AI) — Cotización en PDF.
 *
 * Lo compartido entre servidor y pantalla: la configuración del negocio
 * (datos, lista de productos y condiciones), las partidas de una cotización y
 * el cálculo de totales. Los precios SIEMPRE salen de aquí (de la lista o de
 * lo que escribió una persona), nunca de la IA.
 */

export const ESTADOS_COTIZACION = ["borrador", "enviada", "aceptada", "rechazada", "vencida", "reemplazada"] as const;
export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];

export const ESTADO_INFO: Record<EstadoCotizacion, { etiqueta: string; color: string }> = {
  borrador: { etiqueta: "Borrador", color: "#8b8d98" },
  enviada: { etiqueta: "Enviada", color: "#3e8ed0" },
  aceptada: { etiqueta: "Aceptada", color: "#30a46c" },
  rechazada: { etiqueta: "Rechazada", color: "#e5484d" },
  vencida: { etiqueta: "Vencida", color: "#d6a100" },
  /** Módulo de la agencia: se corrigió con otra (p. ej. una que mandó el agente). */
  reemplazada: { etiqueta: "Corregida", color: "#8b8d98" },
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
  /**
   * Módulo de la agencia: un extra o servicio (flete, instalación, base). Sale
   * en la cotización como cualquiera, pero no es un modelo: no cuenta en
   * Resultados por modelo ni en el reporte, ni se ofrece en la Biblioteca.
   */
  extra: z.boolean().default(false),
});
export type Producto = z.infer<typeof productoSchema>;

/**
 * Módulo de la agencia — una forma de pago o abono que acepta el negocio
 * (Ajustes → Cotizaciones → Condiciones). Todo a mano; sale en el PDF en
 * «Cómo pagar». Solo el nombre es obligatorio.
 */
export const MAX_METODOS_PAGO = 6;
export const metodoPagoSchema = z.object({
  id: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1, "Ponle nombre a la forma de pago (p. ej. «Transferencia BBVA»)").max(60),
  banco: z.string().trim().max(60).default(""),
  titular: z.string().trim().max(120).default(""),
  clabe: z
    .string()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^(\d{18})?$/, "La CLABE lleva 18 números"))
    .default(""),
  cuenta: z.string().trim().max(40).default(""),
  tarjeta: z.string().trim().max(25).default(""),
  notas: z.string().trim().max(300).default(""),
});
export type MetodoPago = z.infer<typeof metodoPagoSchema>;

/** Los renglones de «Cómo pagar» de una forma de pago (lo vacío no sale). */
export function renglonesDePago(m: MetodoPago): string[] {
  const r: string[] = [];
  if (m.banco) r.push(`Banco: ${m.banco}`);
  if (m.titular) r.push(`A nombre de: ${m.titular}`);
  if (m.clabe) r.push(`CLABE: ${m.clabe}`);
  if (m.cuenta) r.push(`Cuenta: ${m.cuenta}`);
  if (m.tarjeta) r.push(`Tarjeta: ${m.tarjeta}`);
  if (m.notas) r.push(m.notas);
  return r;
}

/** Módulo de la agencia: el recuadro del PDF que le dice al cliente cómo cerrar. */
export const TEXTO_ACEPTAR_POR_DEFECTO =
  "Para apartar tu pedido, responde «SÍ» a este mensaje por WhatsApp o paga el anticipo de {anticipo}.";

/** {anticipo} (o el total si no hay anticipo), {total} y {folio}. */
export function textoComoAceptar(plantilla: string, v: { anticipo: string; total: string; folio: string }): string {
  return plantilla
    .replace(/\{anticipo\}/g, v.anticipo)
    .replace(/\{total\}/g, v.total)
    .replace(/\{folio\}/g, v.folio)
    .trim();
}

export const negocioSchema = z.object({
  nombre: z.string().trim().max(120).default(""),
  rfc: z.string().trim().max(20).default(""),
  direccion: z.string().trim().max(200).default(""),
  telefono: z.string().trim().max(40).default(""),
  correo: z.string().trim().max(120).default(""),
});

export const MENSAJE_POR_DEFECTO =
  "Hola {nombre}, te comparto tu cotización {folio} por {total}. Es válida hasta el {vigencia}. Cualquier duda, aquí estamos.";

/* ------------------------------------------------------------------
 * Seguimiento a cotizaciones sin respuesta (2026-11-16)
 * ------------------------------------------------------------------ */

export const TEXTO_SEGUIMIENTO_POR_DEFECTO =
  "Hola {nombre}, ¿pudiste revisar la cotización de {producto} que te mandé? Si quieres la ajustamos o te resuelvo cualquier duda por aquí.";

/** Texto sugerido para dar de alta la plantilla (Marketing): {{1}} nombre, {{2}} producto. */
export const PLANTILLA_SEGUIMIENTO_SUGERIDA =
  "Hola {{1}}, ¿pudiste revisar la cotización de {{2}} que te enviamos? Si quieres la ajustamos o resolvemos tus dudas por aquí.";

export const seguimientoCotSchema = z.object({
  activo: z.boolean().default(false),
  /** Recordatorio con texto normal antes de que se cierre la ventana de 24 h (gratis, sin plantilla). */
  conTexto: z.boolean().default(true),
  texto: z.string().trim().min(1).max(600).default(TEXTO_SEGUIMIENTO_POR_DEFECTO),
  /** Recordatorio con plantilla a los N días de enviada. */
  dias: z.coerce.number().int().min(1).max(30).default(3),
  plantillaId: z.string().trim().max(60).nullable().default(null),
});
export type SeguimientoCot = z.infer<typeof seguimientoCotSchema>;
export const SEGUIMIENTO_COT_POR_DEFECTO: SeguimientoCot = seguimientoCotSchema.parse({});

export const configSchema = z.object({
  negocio: negocioSchema.default({ nombre: "", rfc: "", direccion: "", telefono: "", correo: "" }),
  productos: z.array(productoSchema).max(MAX_PRODUCTOS, `Máximo ${MAX_PRODUCTOS} productos`).default([]),
  vigenciaDias: z.coerce.number().int().min(1).max(365).default(15),
  ivaPct: z.coerce.number().min(0).max(30).default(16),
  /** true: los precios de la lista ya traen IVA (el IVA se desglosa hacia dentro). */
  preciosConIva: z.boolean().default(false),
  anticipoPct: z.coerce.number().min(0).max(100).default(50),
  formaPago: z.string().trim().max(300).default("Transferencia o depósito bancario."),
  /** Módulo de la agencia: el recuadro «cómo aceptar» del PDF (vacío = no sale). */
  comoAceptar: z.string().trim().max(300).default(TEXTO_ACEPTAR_POR_DEFECTO),
  /** Módulo de la agencia: fotos de los modelos cotizados, de la Biblioteca. */
  fotosEnPdf: z.boolean().default(true),
  /** Módulo de la agencia: las cuentas y formas de abono, para «Cómo pagar» del PDF. */
  metodosPago: z.array(metodoPagoSchema).max(MAX_METODOS_PAGO, `Máximo ${MAX_METODOS_PAGO} formas de pago`).default([]),
  condiciones: z.string().trim().max(1500).default(""),
  /** El texto que acompaña al PDF en WhatsApp. {nombre} {folio} {total} {vigencia}. */
  mensaje: z.string().trim().min(1).max(600).default(MENSAJE_POR_DEFECTO),
  moneda: z.enum(["MXN", "USD"]).default("MXN"),
  seguimiento: seguimientoCotSchema.default(SEGUIMIENTO_COT_POR_DEFECTO),
  /** Avisar cuando el cliente parece decir que sí a una cotización enviada. */
  detectarSi: z.boolean().default(true),
  /** Módulo de la agencia: el agente como vendedor (Ajustes → Ventas → Vendedor). */
  vendedor: vendedorSchema.default(VENDEDOR_POR_DEFECTO),
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
  /** Módulo de la agencia: corrige a esta cotización enviada (queda «reemplazada» al mandar). */
  reemplazaA: z.string().trim().max(60).nullable().default(null),
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
  /** Seguimiento detenido para esta cotización. */
  seguimientoPausado: boolean;
  /** El cliente parece haber dicho que sí: lo que escribió y cuándo. */
  senal: { texto: string; en: string } | null;
  /** Módulo de la agencia: la armó el agente (vendedor). */
  deAgente: boolean;
  /** La mandó el agente solo, sin que una persona la revisara. */
  automatica: boolean;
  /** Corrige a esta otra (su id), que quedó «reemplazada» al mandarse. */
  reemplazaA: string | null;
};

/** Cómo va el seguimiento de una cotización enviada (para la tarjeta de la bandeja). */
export type SeguimientoCotDto = {
  /** Lo que ya salió. */
  toques: { toque: Toque; estado: "enviado" | "omitido" | "fallido"; detalle: string | null; en: string }[];
  /** El que sigue, si hay. */
  siguiente: { toque: Toque; fecha: string } | null;
  /** Por qué no corre (null = corre o ya terminó). */
  motivo: string | null;
};

export type Toque = "texto" | "plantilla";

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
export const VENTANA_MS = DIA_MS;
/** El recordatorio de texto sale cuando faltan 2 h para que se cierre la ventana… */
export const TEXTO_ANTES_DE_CERRAR_MS = 2 * HORA_MS;
/** …pero nunca antes de 3 h de enviada la cotización. */
export const MIN_TRAS_ENVIO_MS = 3 * HORA_MS;
/** Margen final: con menos de 5 minutos de ventana ya no se arriesga. */
const MARGEN_CIERRE_MS = 5 * 60_000;
/** Un recordatorio con plantilla que se pasó más de esto (revisor apagado) ya no sale. */
export const GRACIA_PLANTILLA_MS = 48 * HORA_MS;
/** Entre el recordatorio de texto y el de plantilla, al menos esto. */
export const ENTRE_TOQUES_MS = 20 * HORA_MS;

type EntradaToque = {
  ahora: Date;
  enviadaEn: Date;
  /** Último mensaje del cliente (cualquiera). */
  ultimoDelCliente: Date | null;
  /** Lo que ya salió para esta cotización, con su fecha. */
  hechos: readonly { toque: Toque; en: Date }[];
  config: SeguimientoCot;
};

function ventanaDelTexto(e: EntradaToque): { desde: number; hasta: number } | null {
  if (!e.config.conTexto || !e.ultimoDelCliente) return null;
  if (e.hechos.some((h) => h.toque === "texto" || h.toque === "plantilla")) return null;
  const cierra = e.ultimoDelCliente.getTime() + VENTANA_MS;
  const desde = Math.max(cierra - TEXTO_ANTES_DE_CERRAR_MS, e.enviadaEn.getTime() + MIN_TRAS_ENVIO_MS);
  const hasta = cierra - MARGEN_CIERRE_MS;
  return desde < hasta ? { desde, hasta } : null;
}

function momentoDePlantilla(e: EntradaToque): { desde: number; hasta: number } | null {
  if (!e.config.plantillaId) return null;
  if (e.hechos.some((h) => h.toque === "plantilla")) return null;
  let desde = e.enviadaEn.getTime() + e.config.dias * DIA_MS;
  const texto = e.hechos.find((h) => h.toque === "texto");
  if (texto) desde = Math.max(desde, texto.en.getTime() + ENTRE_TOQUES_MS);
  return { desde, hasta: e.enviadaEn.getTime() + e.config.dias * DIA_MS + GRACIA_PLANTILLA_MS };
}

/** ¿Le toca recordatorio ahora? Si el cliente ya escribió después de la cotización, nunca. */
export function toqueQueToca(e: EntradaToque): Toque | null {
  if (!e.config.activo) return null;
  if (e.ultimoDelCliente && e.ultimoDelCliente.getTime() > e.enviadaEn.getTime()) return null;
  const t = e.ahora.getTime();
  const tx = ventanaDelTexto(e);
  if (tx && t >= tx.desde && t < tx.hasta) return "texto";
  const pl = momentoDePlantilla(e);
  if (pl && t >= pl.desde && t < pl.hasta) return "plantilla";
  return null;
}

/** El recordatorio que sigue y cuándo sale (para enseñarlo), o null. */
export function siguienteToque(e: EntradaToque): { toque: Toque; fecha: Date } | null {
  if (!e.config.activo) return null;
  if (e.ultimoDelCliente && e.ultimoDelCliente.getTime() > e.enviadaEn.getTime()) return null;
  const t = e.ahora.getTime();
  const tx = ventanaDelTexto(e);
  if (tx && t < tx.hasta) return { toque: "texto", fecha: new Date(Math.max(tx.desde, t)) };
  const pl = momentoDePlantilla(e);
  if (pl && t < pl.hasta) return { toque: "plantilla", fecha: new Date(Math.max(pl.desde, t)) };
  return null;
}

/** El producto principal de la cotización (la partida de más valor) para el recordatorio. */
/**
 * Módulo de la agencia: ¿esta etapa del Pipeline es la de «cotización
 * enviada»? La pone el CRM cuando el PDF sale; una que diga que el cliente
 * PIDIÓ cotización («Pidió cotización», «Solicita cotización») no cuenta.
 */
export function esEtapaDeCotizacion(nombre: string): boolean {
  const n = normalizar(nombre);
  return n.includes("cotiz") && !/\b(pide|pidio|piden|solicit|quiere|interes)/.test(n);
}

/** La etapa abierta de «cotización enviada» del Pipeline, si el negocio tiene una. */
export function etapaDeCotizacion<T extends { name: string; kind: string }>(etapas: readonly T[]): T | null {
  return etapas.find((e) => e.kind === "open" && esEtapaDeCotizacion(e.name)) ?? null;
}

export function productoPrincipal(partidas: readonly Pick<Partida, "concepto" | "cantidad" | "precio">[]): string {
  const conNombre = partidas.filter((p) => p.concepto.trim());
  if (conNombre.length === 0) return "tu proyecto";
  const mayor = [...conNombre].sort((a, b) => b.cantidad * b.precio - a.cantidad * a.precio)[0]!;
  return mayor.concepto.trim().slice(0, 80);
}

/** El texto del recordatorio con {nombre} {producto} {folio} llenos. */
export function textoDeSeguimiento(plantilla: string, datos: { nombre: string; producto: string; folio: string }): string {
  const primerNombre = datos.nombre.trim().split(/\s+/)[0] ?? "";
  return plantilla
    .replaceAll("{nombre}", primerNombre)
    .replaceAll("{producto}", datos.producto)
    .replaceAll("{folio}", datos.folio)
    .replace(/\s+,/g, ",")
    .replace(/Hola ,/g, "Hola,")
    .trim();
}

/* ------------------------------------------------------------------
 * El cliente dice que sí (2026-11-16)
 * ------------------------------------------------------------------ */

/** Frases que casi siempre son un «sí» (o preguntar cómo pagar). */
const FUERTES: readonly RegExp[] = [
  /\b(a|en) (que|cual) cuenta\b/,
  /\bclabe\b/,
  /\bnumero de cuenta\b/,
  /\bdatos (bancarios|de (la )?cuenta|para (el )?(pago|deposito|transferencia))\b/,
  /\b(lo|la|los|las) quiero\b/,
  /\bme (lo|la|los|las) llevo\b/,
  /\b(acepto|aceptamos|aceptada)\b/,
  /\b(como|donde) (te |le |les )?(pago|deposito|transfiero|hago el (pago|deposito))\b/,
  /\b(ya )?(te |le |les )?(deposite|transferi|pague|hice el (deposito|pago)|mande el comprobante)\b/,
  /\b(cerramos|trato hecho|vamos con (ese|esa|el|la))\b/,
  /\b(apartar|aparto|apartamelo|apartalo|apartala)\b/,
  /\b(quiero|vamos a|voy a) (dar|pagar|hacer) el anticipo\b/,
];

/** Pistas que podrían ser un «sí»: solo cuentan si la IA lo confirma. */
const DEBILES: readonly RegExp[] = [
  /\b(va|sale|ok|okay|listo|perfecto|adelante|de acuerdo|me interesa|me convence|me gusta)\b/,
  /\b(si|sii+)\b/,
  /\b(anticipo|pago|pagar|deposito|depositar|transferencia|transferir)\b/,
  /\bquiero\b/,
  /\b(cuando|cuanto tarda|en cuanto tiempo) (me )?(lo |la )?(entregan|instalan|llega)\b/,
];

const NEGACIONES: readonly RegExp[] = [
  /\bno (lo|la|los|las) quiero\b/,
  /\bno me (interesa|convence)\b/,
  /\b(todavia|aun) no\b/,
  /\b(muy caro|esta caro|lo voy a pensar|lo pienso|dejame pensarlo)\b/,
];

/** Primer filtro, sin IA: ¿lo que escribió el cliente huele a «sí»? */
export function pistaDeAceptacion(texto: string): "fuerte" | "debil" | null {
  const t = normalizar(texto);
  if (!t) return null;
  if (NEGACIONES.some((r) => r.test(t))) return null;
  if (FUERTES.some((r) => r.test(t))) return "fuerte";
  if (DEBILES.some((r) => r.test(t))) return "debil";
  return null;
}

export const respuestaAceptacionSchema = z.object({
  acepta: z.boolean(),
  frase: z.string().max(300).default(""),
});

export const PROMPT_ACEPTACION = [
  "Eres analista de ventas. Un negocio le mandó una cotización a un cliente por WhatsApp.",
  "Lee los mensajes que el cliente escribió DESPUÉS de recibirla y decide si ACEPTA la cotización:",
  "dice que sí la quiere, pregunta a qué cuenta depositar o cómo pagar el anticipo, dice que ya pagó,",
  "o pide apartar. NO cuenta como aceptar: hacer preguntas sobre el producto, pedir descuento o",
  "cambios, decir que lo va a pensar, o un «ok» que solo confirma que recibió el PDF.",
  'Responde SOLO JSON: {"acepta": true|false, "frase": "<el mensaje del cliente que lo demuestra, tal cual, o vacío>"}',
].join("\n");

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
