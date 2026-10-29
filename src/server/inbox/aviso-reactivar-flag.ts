/**
 * Módulo de la agencia (Treviño AI) — Avisarle al cliente al reactivar la IA.
 *
 * Bandera de despliegue `AVISAR_AL_REACTIVAR_IA`, apagada por defecto como
 * todo módulo opcional (ADR-001). Encendida, al reactivar la IA de una
 * conversación con la ventana de 24 h abierta, la bandeja ofrece mandarle al
 * cliente un aviso editable («te dejo con nuestra asistente…») antes de
 * devolverle la conversación al agente.
 */
import { parsePausaPorHumanoFlag } from "./pausa-por-humano-flag";

export function avisoReactivarEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.AVISAR_AL_REACTIVAR_IA);
}
