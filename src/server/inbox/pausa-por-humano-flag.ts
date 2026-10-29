/**
 * Módulo de la agencia (Treviño AI) — Pausa la IA cuando responde una persona.
 *
 * Bandera de despliegue `PAUSAR_IA_AL_RESPONDER`, apagada por defecto como
 * todo módulo opcional (ADR-001): una instancia que no la pide se porta igual
 * que el Vocero raíz.
 *
 * Se lee de `process.env` directo, igual que `agendaEnabled()`: preguntar si
 * una feature existe no puede depender de que TODO el entorno valide.
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parsePausaPorHumanoFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function pausaPorHumanoEnabled(): boolean {
  return parsePausaPorHumanoFlag(process.env.PAUSAR_IA_AL_RESPONDER);
}
