/**
 * Módulo de la agencia (Treviño AI) — Nea aprende de sus traspasos.
 *
 * Bandera de despliegue `APRENDE_DE_TRASPASOS`, apagada por defecto (ADR-001).
 * Apagada: no se registra ningún traspaso, no hay tarjeta en la pantalla
 * Agente y sus rutas responden 404. Encendida, el dueño todavía la enciende o
 * apaga desde esa tarjeta.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function aprendeEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.APRENDE_DE_TRASPASOS);
}
