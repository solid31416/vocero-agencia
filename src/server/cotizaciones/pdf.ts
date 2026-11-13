import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  fechaLarga,
  formatoDinero,
  type ConfigCotizaciones,
  type Partida,
  type Totales,
} from "@/lib/cotizaciones";

/**
 * Módulo de la agencia — el PDF de una cotización, hecho dentro del proceso
 * (pdf-lib, sin servicios externos). Tamaño carta, letra Helvetica estándar:
 * cubre español (acentos, ñ, ¿¡) pero no emojis, que se quitan.
 */

export type DatosPdf = {
  folio: string;
  fecha: Date;
  venceEn: Date;
  cliente: string;
  partidas: Partida[];
  descuentoPct: number;
  notas: string;
  totales: Totales;
  condiciones: Omit<ConfigCotizaciones, "productos">;
  /** Nombre comercial de respaldo si no hay uno en Ajustes → Cotizaciones. */
  nombreMarca: string;
  /** Color del acento (#rrggbb). */
  acento: string;
  logo: { data: Buffer; mime: string } | null;
  zona?: string;
};

const ANCHO = 612; // carta, puntos
const ALTO = 792;
const MARGEN = 48;
const UTIL = ANCHO - MARGEN * 2;

/** Helvetica estándar solo sabe WinAnsi: lo demás (emojis, flechas) se quita. */
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function limpiarTexto(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)) out += ch;
    else if (ch === "\t") out += " ";
  }
  return out.replace(/[ ]{2,}/g, " ");
}

function hexARgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x0d5bff;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Parte un texto en renglones que caben en `ancho`. */
export function partirRenglones(texto: string, fuente: PDFFont, tam: number, ancho: number): string[] {
  const salida: string[] = [];
  for (const parrafo of limpiarTexto(texto).split("\n")) {
    const palabras = parrafo.split(" ");
    let linea = "";
    for (const palabra of palabras) {
      const prueba = linea ? `${linea} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(prueba, tam) <= ancho) {
        linea = prueba;
        continue;
      }
      if (linea) salida.push(linea);
      // Una palabra más larga que el renglón se corta a la fuerza.
      let resto = palabra;
      while (fuente.widthOfTextAtSize(resto, tam) > ancho && resto.length > 1) {
        let i = resto.length - 1;
        while (i > 1 && fuente.widthOfTextAtSize(resto.slice(0, i), tam) > ancho) i--;
        salida.push(resto.slice(0, i));
        resto = resto.slice(i);
      }
      linea = resto;
    }
    salida.push(linea);
  }
  return salida;
}

export async function generarPdfCotizacion(d: DatosPdf): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cotización ${d.folio}`);
  pdf.setProducer("Vocero CRM");
  pdf.setCreator("Vocero CRM");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const acento = hexARgb(d.acento);
  const gris = rgb(0.42, 0.43, 0.47);
  const tinta = rgb(0.1, 0.11, 0.13);
  const linea = rgb(0.86, 0.87, 0.89);
  const moneda = d.condiciones.moneda ?? "MXN";
  const dinero = (n: number) => formatoDinero(n, moneda);
  const zona = d.zona ?? "America/Mexico_City";

  let logo: PDFImage | null = null;
  if (d.logo) {
    try {
      logo = d.logo.mime === "image/png" ? await pdf.embedPng(d.logo.data) : await pdf.embedJpg(d.logo.data);
    } catch {
      logo = null; // un logo dañado no impide la cotización
    }
  }

  let pagina: PDFPage = pdf.addPage([ANCHO, ALTO]);
  let y = ALTO - MARGEN;

  const texto = (
    s: string,
    x: number,
    yy: number,
    o: { f?: PDFFont; t?: number; c?: ReturnType<typeof rgb>; alinear?: "izq" | "der"; ancho?: number } = {}
  ) => {
    const f = o.f ?? normal;
    const t = o.t ?? 9.5;
    const limpio = limpiarTexto(s);
    const w = f.widthOfTextAtSize(limpio, t);
    const xx = o.alinear === "der" ? x + (o.ancho ?? 0) - w : x;
    pagina.drawText(limpio, { x: xx, y: yy, size: t, font: f, color: o.c ?? tinta });
  };

  const nuevaPagina = () => {
    pagina = pdf.addPage([ANCHO, ALTO]);
    y = ALTO - MARGEN;
  };
  const asegurar = (alto: number, conEncabezadoTabla = false) => {
    if (y - alto < MARGEN + 24) {
      nuevaPagina();
      if (conEncabezadoTabla) encabezadoTabla();
    }
  };

  // ---------------------------------------------------------------- encabezado
  const neg = d.condiciones.negocio;
  const nombreNegocio = neg.nombre || d.nombreMarca;
  let xDatos = MARGEN;
  if (logo) {
    const escala = Math.min(120 / logo.width, 56 / logo.height, 1);
    const w = logo.width * escala;
    const h = logo.height * escala;
    pagina.drawImage(logo, { x: MARGEN, y: y - h, width: w, height: h });
    xDatos = MARGEN + w + 14;
  }
  texto(nombreNegocio, xDatos, y - 14, { f: negrita, t: 14 });
  let yDatos = y - 28;
  for (const dato of [
    neg.rfc ? `RFC: ${neg.rfc}` : "",
    neg.direccion,
    [neg.telefono, neg.correo].filter(Boolean).join("  ·  "),
  ].filter(Boolean)) {
    for (const r of partirRenglones(dato, normal, 8.5, 300)) {
      texto(r, xDatos, yDatos, { t: 8.5, c: gris });
      yDatos -= 11;
    }
  }

  // Bloque derecho: título, folio y fechas.
  const xDer = ANCHO - MARGEN - 170;
  texto("COTIZACIÓN", xDer, y - 14, { f: negrita, t: 16, c: acento, alinear: "der", ancho: 170 });
  texto(d.folio, xDer, y - 30, { f: negrita, t: 11, alinear: "der", ancho: 170 });
  texto(`Fecha: ${fechaLarga(d.fecha, zona)}`, xDer, y - 44, { t: 8.5, c: gris, alinear: "der", ancho: 170 });
  texto(`Válida hasta: ${fechaLarga(d.venceEn, zona)}`, xDer, y - 56, { t: 8.5, c: gris, alinear: "der", ancho: 170 });

  y = Math.min(yDatos, y - 64) - 14;
  pagina.drawRectangle({ x: MARGEN, y: y - 2, width: UTIL, height: 2.5, color: acento });
  y -= 22;
  texto("Para:", MARGEN, y, { t: 8.5, c: gris });
  texto(d.cliente, MARGEN + 30, y, { f: negrita, t: 10.5 });
  y -= 24;

  // ---------------------------------------------------------------- tabla
  const col = {
    concepto: MARGEN + 6,
    cant: MARGEN + 290,
    unidad: MARGEN + 330,
    precio: MARGEN + 385,
    importe: MARGEN + 450,
  };
  const anchoConcepto = col.cant - col.concepto - 10;
  function encabezadoTabla() {
    pagina.drawRectangle({ x: MARGEN, y: y - 6, width: UTIL, height: 20, color: rgb(0.95, 0.96, 0.97) });
    texto("Concepto", col.concepto, y, { f: negrita, t: 8.5 });
    texto("Cant.", col.cant - 20, y, { f: negrita, t: 8.5, alinear: "der", ancho: 50 });
    texto("Unidad", col.unidad, y, { f: negrita, t: 8.5 });
    texto("P. unitario", col.precio - 10, y, { f: negrita, t: 8.5, alinear: "der", ancho: 70 });
    texto("Importe", col.importe, y, { f: negrita, t: 8.5, alinear: "der", ancho: UTIL + MARGEN - col.importe - 6 });
    y -= 22;
  }
  encabezadoTabla();

  for (const p of d.partidas) {
    const renglones = partirRenglones(p.concepto, negrita, 9.5, anchoConcepto);
    const desc = p.descripcion ? partirRenglones(p.descripcion, normal, 8, anchoConcepto) : [];
    const alto = renglones.length * 12 + desc.length * 10 + 10;
    asegurar(alto, true);
    const yFila = y;
    renglones.forEach((r, i) => texto(r, col.concepto, yFila - i * 12, { f: negrita, t: 9.5 }));
    desc.forEach((r, i) => texto(r, col.concepto, yFila - renglones.length * 12 - i * 10 + 2, { t: 8, c: gris }));
    const cant = Number.isInteger(p.cantidad) ? String(p.cantidad) : p.cantidad.toFixed(2);
    texto(cant, col.cant - 20, yFila, { alinear: "der", ancho: 50 });
    texto(p.unidad, col.unidad, yFila, { t: 8.5, c: gris });
    texto(dinero(p.precio), col.precio - 10, yFila, { alinear: "der", ancho: 70 });
    texto(dinero(p.cantidad * p.precio), col.importe, yFila, {
      f: negrita,
      alinear: "der",
      ancho: UTIL + MARGEN - col.importe - 6,
    });
    y -= alto;
    // Entre el renglón de abajo de esta partida y el de arriba de la siguiente.
    pagina.drawLine({ start: { x: MARGEN, y: y + 14 }, end: { x: MARGEN + UTIL, y: y + 14 }, thickness: 0.6, color: linea });
  }

  // ---------------------------------------------------------------- totales
  const t = d.totales;
  const filas: [string, string, boolean][] = [["Subtotal", dinero(t.subtotal), false]];
  if (t.descuento > 0) filas.push([`Descuento (${d.descuentoPct}%)`, `-${dinero(t.descuento)}`, false]);
  if (d.condiciones.ivaPct > 0) {
    if (d.condiciones.preciosConIva) {
      filas.push([`Base (sin IVA)`, dinero(t.base), false]);
      filas.push([`IVA incluido (${d.condiciones.ivaPct}%)`, dinero(t.iva), false]);
    } else {
      if (t.descuento > 0) filas.push(["Subtotal con descuento", dinero(t.base), false]);
      filas.push([`IVA (${d.condiciones.ivaPct}%)`, dinero(t.iva), false]);
    }
  }
  filas.push([`Total ${moneda}`, dinero(t.total), true]);
  if (d.condiciones.anticipoPct > 0 && d.condiciones.anticipoPct < 100) {
    filas.push([`Anticipo (${d.condiciones.anticipoPct}%)`, dinero(t.anticipo), false]);
  }
  asegurar(filas.length * 16 + 20);
  y -= 8;
  const xEtiq = MARGEN + UTIL - 230;
  for (const [etiq, valor, fuerte] of filas) {
    if (fuerte) {
      y -= 6; // aire para que la barra no toque el renglón de arriba
      pagina.drawRectangle({ x: xEtiq - 8, y: y - 6, width: 238, height: 20, color: acento });
      texto(etiq, xEtiq, y, { f: negrita, t: 10.5, c: rgb(1, 1, 1) });
      texto(valor, xEtiq, y, { f: negrita, t: 10.5, c: rgb(1, 1, 1), alinear: "der", ancho: 224 });
      y -= 22;
    } else {
      texto(etiq, xEtiq, y, { t: 9, c: gris });
      texto(valor, xEtiq, y, { t: 9.5, alinear: "der", ancho: 224 });
      y -= 16;
    }
  }

  // ---------------------------------------------------------------- notas y condiciones
  const bloques: [string, string][] = [];
  if (d.notas.trim()) bloques.push(["Notas", d.notas]);
  const cond: string[] = [];
  if (d.condiciones.formaPago) cond.push(`Forma de pago: ${d.condiciones.formaPago}`);
  if (d.condiciones.anticipoPct > 0 && d.condiciones.anticipoPct < 100) {
    cond.push(`Anticipo del ${d.condiciones.anticipoPct}% para confirmar el pedido; el resto según lo acordado.`);
  }
  cond.push(`Precios en ${moneda === "MXN" ? "pesos mexicanos" : "dólares estadounidenses"}, válidos hasta el ${fechaLarga(d.venceEn, zona)}.`);
  if (d.condiciones.condiciones.trim()) cond.push(d.condiciones.condiciones);
  bloques.push(["Condiciones", cond.join("\n")]);

  y -= 12;
  for (const [titulo, cuerpo] of bloques) {
    const renglones = partirRenglones(cuerpo, normal, 8.5, UTIL);
    asegurar(28);
    texto(titulo, MARGEN, y, { f: negrita, t: 10, c: acento });
    y -= 14;
    for (const r of renglones) {
      asegurar(12);
      texto(r, MARGEN, y, { t: 8.5, c: gris });
      y -= 11.5;
    }
    y -= 10;
  }

  // ---------------------------------------------------------------- pie
  const paginas = pdf.getPages();
  paginas.forEach((pg, i) => {
    const pie = limpiarTexto(`${nombreNegocio} · ${d.folio} · Página ${i + 1} de ${paginas.length}`);
    const w = normal.widthOfTextAtSize(pie, 7.5);
    pg.drawText(pie, { x: (ANCHO - w) / 2, y: 24, size: 7.5, font: normal, color: gris });
  });

  return Buffer.from(await pdf.save());
}

/** Nombre del archivo que ve el cliente en WhatsApp. */
export function nombreArchivo(folio: string, negocio: string): string {
  const limpio = negocio
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `Cotizacion-${folio}${limpio ? `-${limpio}` : ""}.pdf`;
}
