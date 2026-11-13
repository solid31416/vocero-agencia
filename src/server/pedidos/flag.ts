/**
 * Módulo de la agencia (Treviño AI) — Estado del pedido.
 *
 * Bandera de despliegue `PEDIDOS`, apagada por defecto (ADR-001). Apagada:
 * ni «Pedidos» en el menú, ni el botón de la bandeja, ni Ajustes → Pedidos
 * aparecen, y sus rutas responden 404.
 */
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

export function pedidosEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.PEDIDOS);
}
