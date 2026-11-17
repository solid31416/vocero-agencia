/**
 * Módulo de la agencia (Treviño AI) — a qué etapa pasa el trato al agendar.
 *
 * Antes avanzaba a «la siguiente etapa abierta», y en un embudo como
 * Nuevo → Calificado → Cotización enviada → Visita o demo, agendar desde
 * «Calificado» lo dejaba en «Cotización enviada» sin cotización. Ahora:
 *
 *   1. Si más adelante hay una etapa de visita / demo / cita, va a ESA.
 *   2. Si ya está en ella o la pasó, no se mueve (nunca retrocede).
 *   3. Si el embudo no tiene una, la siguiente abierta, saltando las que el
 *      negocio reserva (con cotizaciones, «Cotización enviada» la pone el CRM).
 */

const VISITA = /\b(visita|visitas|demo|demos|demostracion|cita|citas|showroom|recorrido|reunion|llamada)\b/;

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function esEtapaDeVisita(nombre: string): boolean {
  return VISITA.test(normalizar(nombre));
}

export function etapaAlAgendar<T extends { id: string; name: string; kind: string; position: number }>(
  etapas: readonly T[],
  actualId: string,
  opciones: { saltar?: (nombre: string) => boolean } = {}
): T | null {
  const orden = [...etapas].sort((a, b) => a.position - b.position);
  const i = orden.findIndex((s) => s.id === actualId);
  if (i < 0) return null;
  const adelante = orden.filter((s, j) => j > i && s.kind === "open");
  const visita = adelante.find((s) => esEtapaDeVisita(s.name));
  if (visita) return visita;
  if (orden.some((s, j) => j <= i && esEtapaDeVisita(s.name))) return null;
  return adelante.find((s) => !opciones.saltar?.(s.name)) ?? null;
}
