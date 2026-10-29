/**
 * Módulo de la agencia (Treviño AI) — Laboratorio a la medida.
 *
 * Bandera de despliegue `LAB_A_LA_MEDIDA`, apagada por defecto (ADR-001).
 * Apagada, el Laboratorio es el de siempre (los 8 clientes de fábrica), sus
 * rutas nuevas dan 404 y las tablas del módulo ni se crean.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function labALaMedidaEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.LAB_A_LA_MEDIDA);
}
