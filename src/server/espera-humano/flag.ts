/**
 * Módulo de la agencia (Treviño AI) — «Nadie ha contestado».
 *
 * Bandera de despliegue `ESPERA_HUMANO`, apagada por defecto (ADR-001).
 * Apagada: no hay contador en la bandeja, no se le escribe a nadie, no hay
 * tarjeta en Ajustes → IA y sus rutas responden 404. Encendida, el dueño
 * todavía lo enciende o apaga desde Ajustes → IA.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function esperaEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.ESPERA_HUMANO);
}
