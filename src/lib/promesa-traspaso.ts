/**
 * Módulo de la agencia (Treviño AI) — red de seguridad del traspaso.
 *
 * A veces el agente le DICE al cliente «te paso con una persona del equipo»
 * pero no pide el traspaso: la IA sigue a cargo, nadie recibe aviso y nadie
 * contesta. Aquí se reconoce esa promesa en el texto que salió; el CRM espera
 * unos segundos y, si el traspaso no llegó, lo hace él (ver
 * `src/server/bot/promesa-traspaso.ts`). Lo puro vive aquí para probarlo.
 *
 * Solo cuenta una AFIRMACIÓN: «¿Quieres que te pase con un asesor?» o «Si
 * prefieres, te paso con alguien» son ofertas, no promesas.
 */

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9?\s]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const PERSONA =
  "(asesor|asesora|asesores|persona|personas|equipo|vendedor|vendedora|ejecutivo|ejecutiva|humano|companero|companera|encargado|encargada|alguien|especialista)";

const PROMESAS: RegExp[] = [
  // «te paso con una persona del equipo», «te comunico con un asesor»
  new RegExp(
    `\\b(te|lo|la|le) (paso|comunico|canalizo|conecto|transfiero|dejo) con (un |una |el |la |nuestro |nuestra |nuestros |alguien )?${PERSONA}`
  ),
  // «ya pasé tu proyecto al asesor», «turno tu caso con el equipo»
  new RegExp(
    `\\b(paso|pase|turno|turne|canalizo|canalice|transfiero|transferi|comparto|comparti|envio|envie) (tu|tus|su|sus|el|la|los|las) \\w+( \\w+)? (al|a un|a una|a la|a el|con el|con la|con un|con una|a nuestro|a nuestra) ${PERSONA}`
  ),
  // «un asesor te contacta», «una persona del equipo te confirma»
  new RegExp(
    `\\b(un|una|el|la|nuestro|nuestra) ${PERSONA}( del equipo| de ventas| de nuestro equipo)? (te|le|los) (contacta|contactara|va a contactar|escribe|escribira|va a escribir|llama|llamara|va a llamar|confirma|confirmara|atiende|atendera|responde|respondera|ayuda|ayudara|prepara|preparara|envia|enviara|manda|mandara)\\b`
  ),
];

/** Arranques de oferta: lo que sigue es una pregunta o una opción, no una promesa. */
const OFERTA = /^(si (quieres|gustas|prefieres|lo prefieres|deseas|lo deseas|necesitas)|quieres que|te gustaria que|puedo|podemos|prefieres que)\b/;

/** ¿El mensaje le promete al cliente que lo atiende una persona? */
export function prometeTraspaso(texto: string): boolean {
  // Una oración por pedazo; el signo de cierre se queda en su oración.
  const oraciones = texto.split(/(?<=[.!?\n])/);
  for (const cruda of oraciones) {
    if (cruda.includes("?") || cruda.includes("¿")) continue;
    const o = normalizar(cruda);
    if (!o || OFERTA.test(o)) continue;
    if (PROMESAS.some((r) => r.test(o))) return true;
  }
  return false;
}
