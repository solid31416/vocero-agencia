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

/* Recordar el saldo al cliente (2026-11-16) */
export const TEXTO_SALDO_POR_DEFECTO =
  "Hola {nombre}, te recordamos que queda un saldo de {saldo} de tu pedido {folio}. Cuando lo tengas listo, mándanos tu comprobante por aquí. ¡Gracias!";
/** Para dar de alta en Plantillas (Utilidad): {{1}} nombre, {{2}} saldo, {{3}} folio. */
export const PLANTILLA_SALDO_SUGERIDA =
  "Hola {{1}}, te recordamos que queda un saldo de {{2}} de tu pedido {{3}}. Cuando lo tengas listo, mándanos tu comprobante por este medio. ¡Gracias!";
/** Si el revisor estuvo apagado, un recordatorio con más de estos días de atraso ya no sale solo. */
export const DIAS_GRACIA_SALDO = 3;

export const recordarSaldoSchema = z.object({
  activo: z.boolean().default(false),
  texto: z.string().trim().min(1).max(MAX_MENSAJE).default(TEXTO_SALDO_POR_DEFECTO),
  plantillaId: z.string().trim().max(60).nullable().default(null),
  /** Hora del negocio a la que sale el día de cobro. */
  hora: z.coerce.number().int().min(6).max(21).default(10),
});
export type RecordarSaldo = z.infer<typeof recordarSaldoSchema>;
export const RECORDAR_SALDO_POR_DEFECTO: RecordarSaldo = recordarSaldoSchema.parse({});

export const configSchema = z
  .object({
    etapas: z.array(etapaSchema).min(MIN_ETAPAS).max(MAX_ETAPAS).default(ETAPAS_POR_DEFECTO),
    /** Para avisar con la ventana de 24 h cerrada: {{1}} nombre, {{2}} folio, {{3}} etapa. */
    plantillaId: z.string().trim().max(60).nullable().default(null),
    /** Anotar el estado en la ficha del contacto (el agente la lee). */
    actualizarFicha: z.boolean().default(true),
    /** Recordarle el saldo al cliente el día de cobro. */
    recordarSaldo: recordarSaldoSchema.default(RECORDAR_SALDO_POR_DEFECTO),
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
  /** Cuándo toca cobrar el saldo (anticipo y saldo). */
  cobrarSaldoEl: fechaSchema.optional(),
});
export type Cambio = z.infer<typeof cambioSchema>;

/* ------------------------------------------------------------------
 * Anticipo y saldo — los pagos de un pedido.
 * ------------------------------------------------------------------ */

export const MAX_PAGOS = 50;

export const pagoInputSchema = z.object({
  monto: z.number().positive("El pago debe ser mayor a cero").max(1e10),
  /** Cuándo se recibió (AAAA-MM-DD); por defecto, hoy. */
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD")
    .nullable()
    .default(null),
  nota: z.string().trim().max(200).default(""),
  /** Avisarle al cliente que se recibió su pago. */
  avisar: z.boolean().default(false),
  /** El texto del aviso, si quien registra lo editó. */
  mensaje: z.string().trim().max(MAX_MENSAJE).optional(),
});
export type PagoInput = z.infer<typeof pagoInputSchema>;

export type Pago = {
  id: string;
  monto: number;
  fecha: string;
  nota: string;
  /** Anticipo (el primero), Abono o Liquidación (el que deja el saldo en cero). */
  tipo: "anticipo" | "abono" | "liquidacion";
  por: string | null;
  creadoEn: string;
};

export const NOMBRE_PAGO: Record<Pago["tipo"], string> = {
  anticipo: "Anticipo",
  abono: "Abono",
  liquidacion: "Liquidación",
};

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Cuánto se ha pagado y cuánto falta (sin monto del pedido, no hay saldo). */
export function resumenPagos(
  monto: number | null,
  pagos: readonly Pick<Pago, "monto">[]
): { pagado: number; saldo: number | null; liquidado: boolean } {
  const pagado = centavos(pagos.reduce((s, p) => s + p.monto, 0));
  if (monto === null) return { pagado, saldo: null, liquidado: false };
  const saldo = centavos(Math.max(0, monto - pagado));
  return { pagado, saldo, liquidado: monto > 0 && saldo === 0 };
}

/** Qué es un pago nuevo según lo que ya había: el primero es el anticipo. */
export function tipoDePago(monto: number | null, previos: readonly Pick<Pago, "monto">[], nuevo: number): Pago["tipo"] {
  const { saldo } = resumenPagos(monto, [...previos, { monto: nuevo }]);
  // El que deja el saldo en cero es la liquidación (aunque sea el primero: pago de contado).
  if (saldo === 0 && monto !== null && monto > 0) return "liquidacion";
  return previos.length === 0 ? "anticipo" : "abono";
}

/** El aviso al cliente por un pago recibido. */
export function mensajeDePago(v: {
  contacto: string;
  folio: string;
  monto: string;
  saldo: string | null;
  liquidado: boolean;
}): string {
  const nombre = primerNombre(v.contacto);
  const hola = nombre ? `Hola ${nombre}, ` : "Hola, ";
  if (v.liquidado) return `${hola}recibimos tu pago de ${v.monto}: tu pedido ${v.folio} quedó liquidado. ¡Gracias!`;
  const resto = v.saldo ? ` Queda un saldo de ${v.saldo}.` : "";
  return `${hola}recibimos tu pago de ${v.monto} para tu pedido ${v.folio}. ¡Gracias!${resto}`;
}

/** El recordatorio de saldo con {nombre} {saldo} {folio} {concepto} llenos. */
export function textoDeSaldo(
  plantilla: string,
  v: { contacto: string; saldo: string; folio: string; concepto: string }
): string {
  const nombre = primerNombre(v.contacto);
  return plantilla
    .replace(/\{nombre\}/g, nombre)
    .replace(/\{saldo\}/g, v.saldo)
    .replace(/\{folio\}/g, v.folio)
    .replace(/\{concepto\}/g, v.concepto)
    .replace(/\s+,/g, ",")
    .replace(/Hola ,/g, "Hola,")
    .trim();
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/**
 * ¿Sale hoy el recordatorio de saldo? El día de cobro a partir de la hora
 * elegida (o después, si se pasó), una sola vez por fecha de cobro, y no si
 * ya pasaron más de DIAS_GRACIA_SALDO días.
 */
export function tocaRecordarSaldo(v: {
  saldo: number | null;
  cobrarSaldoEl: string | null;
  /** Para qué fecha de cobro ya salió (o se intentó). */
  recordadoPara: string | null;
  hoy: string;
  horaLocal: number;
  hora: number;
}): boolean {
  if (v.saldo === null || v.saldo <= 0 || !v.cobrarSaldoEl) return false;
  if (v.recordadoPara === v.cobrarSaldoEl) return false;
  if (v.cobrarSaldoEl > v.hoy) return false;
  if (diasEntre(v.cobrarSaldoEl, v.hoy) > DIAS_GRACIA_SALDO) return false;
  return v.cobrarSaldoEl < v.hoy || v.horaLocal >= v.hora;
}

/** Toca cobrar el saldo: hay saldo y ya llegó (o pasó) la fecha de cobro. */
export function tocaCobrar(saldo: number | null, cobrarSaldoEl: string | null, hoy: string): boolean {
  return saldo !== null && saldo > 0 && cobrarSaldoEl !== null && cobrarSaldoEl <= hoy;
}

/**
 * La etapa del embudo a la que pasa el lead al registrar el anticipo: la que
 * se llame «Anticipo…» (la de Wis Dome es «Anticipo pagado»). Null si el
 * negocio no tiene una.
 */
export function etapaDeAnticipo<T extends { name: string; kind: string }>(etapas: readonly T[]): T | null {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  // Abierta o de «ganado»: en Wis Dome «Anticipo pagado» ES la etapa ganada.
  return etapas.find((e) => (e.kind === "open" || e.kind === "won") && norm(e.name).includes("anticipo")) ?? null;
}

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
  /** Anticipo y saldo. */
  pagos: Pago[];
  pagado: number;
  /** Lo que falta; null si el pedido no tiene monto. */
  saldo: number | null;
  liquidado: boolean;
  cobrarSaldoEl: string | null;
  /** Hay saldo y ya llegó la fecha de cobrarlo. */
  tocaCobrar: boolean;
  /** El último recordatorio de saldo al cliente: para qué fecha de cobro, cuándo y cómo salió. */
  saldoRecordado: { para: string; en: string; ok: boolean; detalle: string | null } | null;
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
  /** Anticipo y saldo, ya con formato de dinero. */
  pagos?: { pagado: string; saldo: string | null; liquidado: boolean } | null;
}): string {
  const partes = [p.folio, p.concepto.slice(0, 120), `estado: ${p.etapaNombre}`];
  if (p.fechaEstimada && !p.esUltima) partes.push(`entrega estimada: ${fechaLegible(p.fechaEstimada)}`);
  if (p.pagos) {
    partes.push(
      p.pagos.liquidado
        ? `pagado: ${p.pagos.pagado} (liquidado)`
        : `pagado: ${p.pagos.pagado}${p.pagos.saldo ? `, falta: ${p.pagos.saldo}` : ""}`
    );
  }
  return partes.join(" · ");
}

/** La posición de la etapa en los ajustes (para la barra de avance). */
export function indiceDeEtapa(etapas: readonly Etapa[], etapaId: string): number {
  return etapas.findIndex((e) => e.id === etapaId);
}
