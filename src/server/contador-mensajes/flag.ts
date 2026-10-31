/**
 * Módulo de la agencia (Treviño AI) — Contador de mensajes y costo de Meta.
 *
 * Bandera de despliegue `CONTADOR_MENSAJES`, apagada por defecto (ADR-001).
 * Apagada: no se guarda el cobro de los avisos de Meta, no hay pantalla ni
 * franja de aviso, el revisor no arranca y sus rutas responden 404.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function contadorEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.CONTADOR_MENSAJES);
}
