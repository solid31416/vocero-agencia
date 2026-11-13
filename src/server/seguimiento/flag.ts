/**
 * Módulo de la agencia (Treviño AI) — Seguimiento automático.
 *
 * Bandera de despliegue `SEGUIMIENTO_AUTOMATICO`, apagada por defecto
 * (ADR-001). Apagada: ni el revisor arranca, ni Ajustes → Seguimiento ni el
 * botón de la bandeja aparecen, y sus rutas responden 404.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function seguimientoEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.SEGUIMIENTO_AUTOMATICO);
}
