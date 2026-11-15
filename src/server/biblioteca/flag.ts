/**
 * Módulo de la agencia (Treviño AI) — Biblioteca de fotos, videos y fichas.
 *
 * Bandera de despliegue `BIBLIOTECA`, apagada por defecto (ADR-001).
 * Apagada: ni Ajustes → Biblioteca ni la herramienta del agente aparecen, el
 * contexto del turno no lleva la lista y sus rutas responden 404.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function bibliotecaEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.BIBLIOTECA);
}
