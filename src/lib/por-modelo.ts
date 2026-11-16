/**
 * Módulo de la agencia (Treviño AI) — Resultados por modelo.
 *
 * Para un negocio de pocos productos (1 a 10: domos, contenedores, casas
 * plegables): por cada uno, cuántos clientes preguntaron, a cuántos se les
 * mandaron fotos o videos, cuántas cotizaciones salieron, cuántas se cerraron
 * y cuánto se vendió. Lo puro (sin base) vive aquí para poder probarlo.
 */

export type FilaModeloDto = {
  productoId: string;
  nombre: string;
  /** Clientes distintos que lo mencionaron, recibieron sus fotos o una cotización con él. */
  interesados: number;
  /** Clientes a los que se les mandaron sus fotos o videos de la Biblioteca. */
  conFotos: number;
  /** Cotizaciones enviadas en el periodo que lo incluyen. */
  cotizadas: number;
  /** De ellas, las aceptadas. */
  aceptadas: number;
  /** % de cierre (aceptadas / cotizadas), null sin cotizaciones. */
  cierre: number | null;
  /** Lo vendido de este producto (sus partidas en cotizaciones aceptadas, sin IVA). */
  vendido: number;
};

export type PorModeloDto = {
  filas: FilaModeloDto[];
  moneda: "MXN" | "USD";
  /** El negocio no tiene lista de productos (Ajustes → Cotizaciones). */
  sinLista: boolean;
};

/** Palabras que no distinguen a un producto de otro. */
const COMUNES = new Set([
  "de", "del", "el", "la", "los", "las", "con", "para", "por", "en", "y", "un", "una",
  "modelo", "tipo", "linea", "serie", "version", "paquete", "kit",
]);

export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Las palabras que identifican a cada producto: las de su nombre que NO
 * comparte con los demás («Domo Mini» y «Domo Estándar» → «mini» y
 * «estandar»; «domo» no dice cuál). Si todas las comparte, su nombre completo.
 */
export function clavesDeProductos(productos: readonly { id: string; nombre: string }[]): Map<string, string[]> {
  const palabras = productos.map((p) => ({
    id: p.id,
    nombre: normalizarTexto(p.nombre),
    toks: [...new Set(normalizarTexto(p.nombre).split(" "))].filter((t) => t.length >= 3 && !COMUNES.has(t)),
  }));
  const cuenta = new Map<string, number>();
  for (const p of palabras) for (const t of p.toks) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  const out = new Map<string, string[]>();
  for (const p of palabras) {
    const propias = p.toks.filter((t) => cuenta.get(t) === 1);
    out.set(p.id, propias.length > 0 ? propias : p.nombre ? [p.nombre] : []);
  }
  return out;
}

/** ¿El texto menciona alguna de estas claves (como palabra o frase completa)? */
export function menciona(texto: string, claves: readonly string[]): boolean {
  if (claves.length === 0) return false;
  const t = ` ${normalizarTexto(texto)} `;
  return claves.some((c) => t.includes(` ${c} `));
}

/** ¿Esta partida (o este título de la Biblioteca) es de este producto? */
export function esDelProducto(
  item: { productoId?: string | null; concepto: string },
  producto: { id: string; nombre: string },
  claves: readonly string[]
): boolean {
  // Con producto de la lista, manda el id (aunque el concepto se haya editado).
  if (item.productoId) return item.productoId === producto.id;
  const c = normalizarTexto(item.concepto);
  const n = normalizarTexto(producto.nombre);
  if (!c || !n) return false;
  return c === n || ` ${c} `.includes(` ${n} `) || menciona(item.concepto, claves);
}

export function porcentajeCierre(aceptadas: number, cotizadas: number): number | null {
  return cotizadas > 0 ? Math.round((aceptadas / cotizadas) * 100) : null;
}
