/**
 * Módulo de la agencia (Treviño AI) — Cotización en PDF.
 *
 * Bandera de despliegue `COTIZACIONES`, apagada por defecto (ADR-001).
 * Apagada: ni el botón «Cotizar» de la bandeja ni Ajustes → Cotizaciones
 * aparecen, y sus rutas responden 404.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function cotizacionesEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.COTIZACIONES);
}
