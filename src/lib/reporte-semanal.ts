import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — Reporte semanal al dueño por WhatsApp.
 *
 * Una vez por semana (día y hora del negocio), un mensaje con cómo fue la
 * semana: clientes nuevos, qué modelos preguntaron, cotizaciones enviadas y
 * cerradas, lo cobrado y lo que falta por cobrar. Para que el dueño sepa cómo
 * va sin entrar al CRM. Lo puro vive aquí para probarlo.
 */

export const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;

export const configSchema = z.object({
  activo: z.boolean().default(false),
  /** Teléfono del dueño (con lada). Tiene que haberle escrito alguna vez a este número. */
  telefonoDueno: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().min(10, "Escribe el teléfono con lada, por ejemplo 5281…").max(15))
    .nullable()
    .default(null),
  /** 0 = domingo … 6 = sábado. */
  dia: z.coerce.number().int().min(0).max(6).default(1),
  hora: z.coerce.number().int().min(6).max(21).default(9),
  /** Para cuando el dueño no ha escrito en 24 h (lo normal). */
  plantillaId: z.string().trim().max(60).nullable().default(null),
});
export type ConfigReporte = z.infer<typeof configSchema>;
export const CONFIG_POR_DEFECTO: ConfigReporte = configSchema.parse({});

/** Para dar de alta en Plantillas (Utilidad). Las variables, en este orden. */
export const PLANTILLA_REPORTE_SUGERIDA =
  "Resumen de tu semana ({{1}}): {{2}} clientes nuevos, {{3}} cotizaciones enviadas, {{4}} cerradas, {{5}} cobrado y {{6}} por cobrar. Revisa el detalle en tu CRM.";

export type ReporteDto = {
  /** Fechas locales: del `desde` al `hasta` (inclusivo). */
  desde: string;
  hasta: string;
  negocio: string;
  moneda: "MXN" | "USD";
  nuevos: number;
  /** Los modelos más preguntados (hasta 3), con cuántos clientes. */
  modelos: { nombre: string; interesados: number }[];
  cotizaciones: { n: number; monto: number } | null;
  cerradas: { n: number; monto: number } | null;
  /** Null si el negocio no usa pedidos. */
  cobrado: number | null;
  porCobrar: { monto: number; tocan: number } | null;
  sinRespuesta: number | null;
  url: string | null;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «9 al 15 nov», «28 oct al 3 nov». */
export function periodoLegible(desde: string, hasta: string): string {
  const [, m1, d1] = desde.split("-").map(Number);
  const [, m2, d2] = hasta.split("-").map(Number);
  const mes1 = MESES[(m1 ?? 1) - 1];
  const mes2 = MESES[(m2 ?? 1) - 1];
  return m1 === m2 ? `${d1} al ${d2} ${mes2}` : `${d1} ${mes1} al ${d2} ${mes2}`;
}

function dinero(n: number, moneda: "MXN" | "USD"): string {
  const s = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(Math.round(n));
  return moneda === "USD" ? `US$${s}` : `$${s}`;
}

/** El mensaje completo (con la ventana abierta sale así). */
export function textoDelReporte(r: ReporteDto): string {
  const $ = (n: number) => dinero(n, r.moneda);
  const lineas = [
    `📊 Tu semana${r.negocio ? ` en ${r.negocio}` : ""} (${periodoLegible(r.desde, r.hasta)})`,
    "",
    `👥 Clientes nuevos: ${r.nuevos}`,
  ];
  if (r.modelos.length > 0) {
    lineas.push(`🏠 Más preguntados: ${r.modelos.map((m) => `${m.nombre} (${m.interesados})`).join(", ")}`);
  }
  if (r.cotizaciones) {
    lineas.push(
      `📄 Cotizaciones enviadas: ${r.cotizaciones.n}${r.cotizaciones.n > 0 ? ` por ${$(r.cotizaciones.monto)}` : ""}`
    );
  }
  if (r.cerradas) {
    lineas.push(`✅ Cerradas: ${r.cerradas.n}${r.cerradas.n > 0 ? ` por ${$(r.cerradas.monto)}` : ""}`);
  }
  if (r.cobrado !== null) lineas.push(`💰 Cobrado: ${$(r.cobrado)}`);
  if (r.porCobrar) {
    const tocan = r.porCobrar.tocan > 0 ? ` (${r.porCobrar.tocan} ya ${r.porCobrar.tocan === 1 ? "toca" : "tocan"})` : "";
    lineas.push(`⏳ Por cobrar: ${$(r.porCobrar.monto)}${tocan}`);
  }
  if (r.sinRespuesta !== null && r.sinRespuesta > 0) {
    lineas.push(`📭 Cotizaciones sin respuesta: ${r.sinRespuesta}`);
  }
  if (r.url) lineas.push("", `Detalle: ${r.url}/results`);
  return lineas.join("\n");
}

/**
 * Los valores de la plantilla. Meta no deja saltos de línea en una variable:
 * con 1 variable va el resumen en una línea; con más, en el orden de
 * PLANTILLA_REPORTE_SUGERIDA. Ninguna queda vacía.
 */
export function variablesDelReporte(r: ReporteDto, cuantas: number): string[] {
  const $ = (n: number) => dinero(n, r.moneda);
  const periodo = periodoLegible(r.desde, r.hasta);
  const cot = r.cotizaciones ? `${r.cotizaciones.n}${r.cotizaciones.n > 0 ? ` (${$(r.cotizaciones.monto)})` : ""}` : "0";
  const cer = r.cerradas ? `${r.cerradas.n}${r.cerradas.n > 0 ? ` (${$(r.cerradas.monto)})` : ""}` : "0";
  const cobrado = $(r.cobrado ?? 0);
  const porCobrar = $(r.porCobrar?.monto ?? 0);
  if (cuantas <= 0) return [];
  if (cuantas === 1) {
    return [
      `${periodo}: ${r.nuevos} clientes nuevos, ${cot} cotizaciones, ${cer} cerradas, ${cobrado} cobrado, ${porCobrar} por cobrar`,
    ];
  }
  return [periodo, String(r.nuevos), cot, cer, cobrado, porCobrar].slice(0, cuantas);
}

/**
 * ¿Sale hoy? El día elegido, desde la hora elegida; una vez por fecha. Si se
 * pasó la hora (el servidor estuvo apagado), sale en cuanto vuelva ese mismo día.
 */
export function tocaReporte(v: {
  config: Pick<ConfigReporte, "activo" | "dia" | "hora">;
  hoy: string;
  diaSemana: number;
  horaLocal: number;
  /** La fecha (local) del último que salió. */
  ultimoPara: string | null;
}): boolean {
  if (!v.config.activo) return false;
  if (v.diaSemana !== v.config.dia || v.horaLocal < v.config.hora) return false;
  return v.ultimoPara !== v.hoy;
}
