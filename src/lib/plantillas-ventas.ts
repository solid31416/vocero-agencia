import { PLANTILLA_SEGUIMIENTO_SUGERIDA } from "@/lib/cotizaciones";
import { PLANTILLA_SALDO_SUGERIDA, PLANTILLA_SUGERIDA as PLANTILLA_PEDIDO } from "@/lib/pedidos";
import { PLANTILLA_SUGERIDA as PLANTILLA_CITA } from "@/lib/recordatorios";
import { PLANTILLA_REPORTE_SUGERIDA } from "@/lib/reporte-semanal";

/**
 * Módulo de la agencia (Treviño AI) — las plantillas que necesitan los
 * avisos automáticos de venta para salir aunque el cliente lleve más de
 * 24 h sin escribir. Los textos son los mismos que sugiere cada pantalla de
 * Ajustes (sus variables, en el mismo orden), así que una vez aprobadas solo
 * hay que elegirlas ahí.
 */

export type ModuloVentas = "cotizaciones" | "pedidos" | "agenda";

export type PlantillaVentas = {
  /** Nombre en Meta (minúsculas y guion bajo); con él se sabe si ya existe. */
  name: string;
  titulo: string;
  paraQue: string;
  category: "UTILITY";
  body: string;
  /** Un ejemplo por variable, en orden: lo que ve quien revisa en Meta. */
  examples: string[];
  modulo: ModuloVentas;
  /** Dónde se elige una vez aprobada. */
  ajustes: { href: string; label: string };
};

export const PLANTILLAS_VENTAS: readonly PlantillaVentas[] = [
  {
    name: "ventas_seguimiento_cotizacion",
    titulo: "Seguimiento de cotización",
    paraQue: "Recordarle al cliente la cotización que no ha contestado.",
    category: "UTILITY",
    body: PLANTILLA_SEGUIMIENTO_SUGERIDA,
    examples: ["Ana", "Domo Modelo Mini"],
    modulo: "cotizaciones",
    ajustes: { href: "/settings/cotizaciones", label: "Cotizaciones → Seguimiento" },
  },
  {
    name: "ventas_avance_pedido",
    titulo: "Avance del pedido",
    paraQue: "Avisarle al cliente cuando su pedido cambia de etapa.",
    category: "UTILITY",
    body: PLANTILLA_PEDIDO,
    examples: ["Ana", "PED-0003", "En fabricación"],
    modulo: "pedidos",
    ajustes: { href: "/settings/pedidos", label: "Pedidos" },
  },
  {
    name: "ventas_saldo_pendiente",
    titulo: "Recordatorio de saldo",
    paraQue: "Recordarle al cliente lo que le falta pagar, el día que toca.",
    category: "UTILITY",
    body: PLANTILLA_SALDO_SUGERIDA,
    examples: ["Ana", "$45,000.00", "PED-0003"],
    modulo: "pedidos",
    ajustes: { href: "/settings/pedidos", label: "Pedidos → Recordarle el saldo" },
  },
  {
    name: "ventas_recordatorio_cita",
    titulo: "Recordatorio de cita",
    paraQue: "Recordarle al cliente su cita o visita.",
    category: "UTILITY",
    body: PLANTILLA_CITA,
    examples: ["Ana", "viernes 20 de noviembre", "10:00 a. m."],
    modulo: "agenda",
    ajustes: { href: "/settings/calendar", label: "Agenda → Recordatorios" },
  },
  {
    name: "ventas_reporte_semanal",
    titulo: "Reporte semanal (para ti)",
    paraQue: "El resumen de la semana que te llega a ti, el dueño.",
    category: "UTILITY",
    body: PLANTILLA_REPORTE_SUGERIDA,
    examples: ["9 al 15 nov", "4", "3 ($620,000)", "1 ($448,920)", "$110,000", "$338,920"],
    modulo: "cotizaciones",
    ajustes: { href: "/settings/reporte", label: "Reporte semanal" },
  },
];

/** Las que aplican según los módulos encendidos en esta instancia. */
export function plantillasVentasPara(m: Record<ModuloVentas, boolean>): PlantillaVentas[] {
  return PLANTILLAS_VENTAS.filter((p) => m[p.modulo]);
}

/** Cuántas variables ({{n}}) usa un texto. */
export function variablesDe(body: string): number {
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1]));
  return nums.length ? Math.max(...nums) : 0;
}
