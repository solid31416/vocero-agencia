/**
 * Módulo de la agencia (Treviño AI) — Recordatorios de cita.
 *
 * Bandera de despliegue `RECORDATORIOS_CITAS`, apagada por defecto (ADR-001).
 * Necesita la agenda (`AGENDA`): sin citas no hay qué recordar. Apagada, ni el
 * revisor arranca, ni la tarjeta de Ajustes → Agenda aparece, ni sus rutas
 * existen (404).
 */
import { agendaEnabled } from "@/server/agenda/flag";
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function recordatoriosEnabled(): boolean {
  return agendaEnabled() && parsePausaPorHumanoFlag(process.env.RECORDATORIOS_CITAS);
}
