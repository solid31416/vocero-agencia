/**
 * Módulo de la agencia (Treviño AI) — Resumen para quien atiende.
 *
 * Bandera de despliegue `RESUMEN_TRASPASO`, apagada por defecto (ADR-001).
 * Apagada: no se arma ningún resumen, no hay recuadro en la bandeja ni
 * tarjeta en Ajustes → IA, y sus rutas responden 404. Encendida, el dueño
 * todavía lo enciende o apaga desde Ajustes → IA.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function resumenEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.RESUMEN_TRASPASO);
}
