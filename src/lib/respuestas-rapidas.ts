/**
 * 049 — Respuestas rápidas: lo puro del menú «/» del compositor, para
 * probarlo sin navegador. Encontrar el `/atajo` que se está escribiendo,
 * filtrar la lista, reemplazarlo por el texto y rellenar `{nombre}`.
 */

export type RespuestaRapida = { id: string; atajo: string; texto: string };

export const ATAJO_MAX = 32;
export const TEXTO_MAX = 4096;
export const TOPE_RESPUESTAS = 200;
export const ATAJO_RE = /^[a-z0-9_-]{1,32}$/;

/** Sin acentos y en minúsculas: «Envío» y «envio» son lo mismo al buscar. */
export function plegar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Pura: el atajo como se guarda. Quita la `/` del inicio, los acentos y los
 * espacios (que pasan a `-`), y todo lo que no sea letra, número, `-` o `_`.
 * Puede devolver vacío: quien llama lo valida con `ATAJO_RE`.
 */
export function normalizarAtajo(entrada: string): string {
  return plegar(entrada.trim().replace(/^\/+/, ""))
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, ATAJO_MAX);
}

/**
 * Pura: el `/atajo` que se está escribiendo justo antes del cursor, si hay.
 * La `/` tiene que estar al inicio de la caja o después de un espacio: así
 * `3/4` o `https://…` no abren el menú.
 */
export function tokenRapido(
  texto: string,
  cursor: number
): { inicio: number; consulta: string } | null {
  const antes = texto.slice(0, cursor);
  const m = /(^|\s)\/([^\s/]{0,32})$/u.exec(antes);
  if (!m) return null;
  return { inicio: antes.length - m[2]!.length - 1, consulta: m[2]! };
}

/**
 * Pura: las respuestas que coinciden. Primero las que EMPIEZAN por la
 * consulta (lo que uno espera al teclear el atajo); después las que la
 * contienen en el atajo o en el texto. Sin consulta, todas por atajo.
 */
export function filtrarRespuestas(
  lista: readonly RespuestaRapida[],
  consulta: string
): RespuestaRapida[] {
  const q = plegar(consulta);
  const porAtajo = [...lista].sort((a, b) => a.atajo.localeCompare(b.atajo));
  if (!q) return porAtajo;
  const empiezan = porAtajo.filter((r) => r.atajo.startsWith(q));
  const contienen = porAtajo.filter(
    (r) => !r.atajo.startsWith(q) && (r.atajo.includes(q) || plegar(r.texto).includes(q))
  );
  return [...empiezan, ...contienen];
}

/**
 * Pura: el primer nombre de un contacto para `{nombre}`. Un nombre que no
 * tiene letras (un teléfono o un BSUID puestos como nombre) no cuenta.
 */
export function primerNombre(nombre: string | null | undefined): string {
  const primero = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return /\p{L}/u.test(primero) && !primero.includes(":") ? primero : "";
}

/**
 * Pura: cambia `{nombre}` por el primer nombre. Sin nombre se quita con el
 * espacio de antes: «Hola {nombre}, ¿qué tal?» → «Hola, ¿qué tal?».
 */
export function rellenarVariables(
  texto: string,
  nombre: string | null | undefined,
  datos: DatosDeVenta = {}
): string {
  const primero = primerNombre(nombre);
  const conNombre = primero
    ? texto.replace(/\{\s*nombre\s*\}/giu, primero)
    : texto.replace(/[ \t]*\{\s*nombre\s*\}/giu, "");
  // Módulo de la agencia: lo de la venta. Lo que no se sabe se queda como
  // `{saldo}` para que quien la manda lo vea y lo escriba a mano.
  return conNombre.replace(/\{\s*([a-z_]+)\s*\}/giu, (todo, clave: string) => {
    const v = datos[clave.toLowerCase() as keyof DatosDeVenta];
    return v ? v : todo;
  });
}

/* ------------------------------------------------------------------
 * Módulo de la agencia — variables de venta y respuestas de arranque.
 * ------------------------------------------------------------------ */

/** Lo que se sabe de la venta de esta conversación, ya con formato. */
export type DatosDeVenta = Partial<
  Record<"folio" | "total" | "anticipo" | "producto" | "pedido" | "saldo" | "fecha_saldo", string>
>;

export const VARIABLES_DE_VENTA: { clave: keyof DatosDeVenta; que: string }[] = [
  { clave: "folio", que: "folio de la última cotización" },
  { clave: "total", que: "total de esa cotización" },
  { clave: "anticipo", que: "anticipo de esa cotización" },
  { clave: "producto", que: "el modelo principal cotizado" },
  { clave: "pedido", que: "folio del pedido" },
  { clave: "saldo", que: "lo que falta pagar del pedido" },
  { clave: "fecha_saldo", que: "cuándo se cobra el saldo" },
];

/** Pura: ¿la respuesta usa alguna variable de venta? (para no pedir datos de más). */
export function usaVariablesDeVenta(texto: string): boolean {
  const claves = new Set(VARIABLES_DE_VENTA.map((v) => v.clave as string));
  return [...texto.matchAll(/\{\s*([a-z_]+)\s*\}/giu)].some((m) => claves.has(m[1]!.toLowerCase()));
}

/** Respuestas de arranque para venta consultiva de producto importado. */
export const RESPUESTAS_DE_ARRANQUE: { atajo: string; texto: string }[] = [
  {
    atajo: "ubicacion",
    texto:
      "Trabajamos en línea y enviamos a todo México. No tenemos sala de exhibición porque cada pieza se importa a pedido; con gusto te mando fotos y videos de proyectos entregados o te hago una videollamada.",
  },
  {
    atajo: "pago",
    texto:
      "Puedes pagar por transferencia o depósito. El anticipo de {anticipo} aparta tu pedido y el saldo se cubre antes de la entrega. ¿Te paso los datos de la cuenta?",
  },
  {
    atajo: "entrega",
    texto:
      "Es de importación: desde que confirmas con el anticipo, la entrega toma de [X a Y] semanas. Te avisamos en cada etapa: fabricación, envío, aduana y entrega.",
  },
  {
    atajo: "garantia",
    texto: "Incluye garantía de [X] contra defectos de fabricación. Te la entregamos por escrito junto con tu pedido.",
  },
  {
    atajo: "cotizacion",
    texto:
      "Hola {nombre}, te recuerdo tu cotización {folio} de {producto} por {total}. Para apartarla basta el anticipo de {anticipo}. ¿Tienes alguna duda?",
  },
  {
    atajo: "saldo",
    texto:
      "Hola {nombre}, de tu pedido {pedido} queda un saldo de {saldo} para el {fecha_saldo}. ¿Te paso los datos para el pago?",
  },
  {
    atajo: "gracias",
    texto: "¡Gracias por tu pago, {nombre}! Ya quedó registrado en tu pedido {pedido}.",
  },
];

/** Pura: los datos de venta a partir de las cotizaciones y pedidos de la conversación. */
export function datosDeVenta(
  cotizaciones: readonly {
    folio: string;
    estado: string;
    partidas: readonly { concepto: string; cantidad: number; precio: number }[];
    totales: { total: number; anticipo: number };
  }[],
  pedidos: readonly { folio: string; saldo: number | null; cobrarSaldoEl: string | null; creadoEn: string }[],
  formato: { dinero: (n: number) => string; fecha: (iso: string) => string }
): DatosDeVenta {
  const d: DatosDeVenta = {};
  // La más reciente que salió (la lista llega de la más nueva a la más vieja).
  const cot = cotizaciones.find((c) => c.estado !== "borrador");
  if (cot) {
    d.folio = cot.folio;
    d.total = formato.dinero(cot.totales.total);
    if (cot.totales.anticipo > 0) d.anticipo = formato.dinero(cot.totales.anticipo);
    const mayor = [...cot.partidas].sort((a, b) => b.cantidad * b.precio - a.cantidad * a.precio)[0];
    if (mayor) d.producto = mayor.concepto;
  }
  const ped = [...pedidos].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))[0];
  if (ped) {
    d.pedido = ped.folio;
    if (ped.saldo !== null) d.saldo = formato.dinero(Math.max(0, ped.saldo));
    if (ped.cobrarSaldoEl) d.fecha_saldo = formato.fecha(ped.cobrarSaldoEl);
  }
  return d;
}

/** Pura: reemplaza el `/atajo` (de `inicio` al cursor) por la respuesta. */
export function aplicarRespuesta(
  texto: string,
  inicio: number,
  cursor: number,
  insercion: string
): { texto: string; cursor: number } {
  return {
    texto: texto.slice(0, inicio) + insercion + texto.slice(cursor),
    cursor: inicio + insercion.length,
  };
}
