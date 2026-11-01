/**
 * Módulo de la agencia (Treviño AI) — Termómetro del cliente.
 *
 * Bandera de despliegue `TERMOMETRO_CLIENTE`, apagada por defecto (ADR-001).
 * Apagada: la IA no clasifica nada, la bandeja no muestra temperatura ni
 * etiquetas, no hay tarjeta en Ajustes → IA y sus rutas responden 404.
 * Encendida, el dueño todavía lo enciende o apaga desde Ajustes → IA.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function termometroEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.TERMOMETRO_CLIENTE);
}
