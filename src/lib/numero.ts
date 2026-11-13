/**
 * Módulos de la agencia (Treviño AI) — campos de número que se dejan
 * escribir. Un `<input type="number">` controlado con `Number(valor)` en cada
 * tecla convierte el campo vacío en 0 y lo vuelve a pintar: borrar «1» y
 * escribir «2» deja «02». Aquí vive la lógica pura de `NumeroInput`: mientras
 * se escribe se guarda el texto tal cual y el número solo se fija al salir.
 */

/** El número que hay en el texto, o `null` si está vacío o a medias («-», «1e»). */
export function textoANumero(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type LimitesNumero = {
  min?: number;
  max?: number;
  /** Solo enteros (días, minutos…): se redondea al salir. */
  entero?: boolean;
  /** Qué valor toma si se sale del campo dejándolo vacío. Por defecto, `min` o 0. */
  vacio?: number;
};

/** Aplica redondeo y límites a un número ya escrito. */
export function ajustarNumero(n: number, { min, max, entero }: LimitesNumero): number {
  let v = entero ? Math.round(n) : n;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/** El valor final al salir del campo (vacío o a medias → `vacio`, si no `min`, si no 0). */
export function numeroAlSalir(texto: string, limites: LimitesNumero): number {
  const n = textoANumero(texto);
  if (n === null) return ajustarNumero(limites.vacio ?? limites.min ?? 0, limites);
  return ajustarNumero(n, limites);
}
