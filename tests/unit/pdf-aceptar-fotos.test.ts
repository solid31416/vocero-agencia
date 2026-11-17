import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { CONFIG_POR_DEFECTO, calcularTotales, configSchema, textoComoAceptar } from "@/lib/cotizaciones";
import { generarPdfCotizacion } from "@/server/cotizaciones/pdf";

/** Módulo de la agencia — el recuadro «cómo aceptar» y las fotos de los modelos en el PDF. */

// Un PNG de 1×1 de verdad (lo que la Biblioteca guardaría como foto).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

describe("PDF: cómo aceptar y fotos", () => {
  it("el texto llena el anticipo, el total y el folio", () => {
    expect(
      textoComoAceptar("Para apartar tu domo, responde SÍ o paga el anticipo de {anticipo} ({folio}, total {total}).", {
        anticipo: "$224,460.00",
        total: "$448,920.00",
        folio: "COT-0009",
      })
    ).toBe("Para apartar tu domo, responde SÍ o paga el anticipo de $224,460.00 (COT-0009, total $448,920.00).");
  });

  it("una configuración vieja trae el texto de siempre y las fotos encendidas", () => {
    const { comoAceptar: _a, fotosEnPdf: _f, ...vieja } = CONFIG_POR_DEFECTO;
    void _a;
    void _f;
    const c = configSchema.parse(vieja);
    expect(c.comoAceptar).toContain("{anticipo}");
    expect(c.fotosEnPdf).toBe(true);
  });

  it("el PDF sale con recuadro y fotos, con una foto dañada, y sin nada", async () => {
    const partidas = [{ productoId: null, concepto: "Domo Modelo Mini", descripcion: "", cantidad: 3, unidad: "pieza", precio: 125000 }];
    const totales = calcularTotales(partidas, { descuentoPct: 0, ivaPct: 16, preciosConIva: false, anticipoPct: 50 });
    const base = {
      folio: "COT-0009",
      fecha: new Date("2026-11-16T18:00:00Z"),
      venceEn: new Date("2026-12-01T18:00:00Z"),
      cliente: "Saúl Garza",
      partidas,
      descuentoPct: 0,
      notas: "",
      totales,
      nombreMarca: "Wis Dome House",
      acento: "#0d5bff",
      logo: null,
      condiciones: CONFIG_POR_DEFECTO,
    };
    const con = await generarPdfCotizacion({
      ...base,
      fotos: [
        { data: PNG, mime: "image/png", titulo: "Domo Modelo Mini" },
        { data: Buffer.from("no soy foto"), mime: "image/jpeg", titulo: "Rota" },
      ],
    });
    expect((await PDFDocument.load(con)).getPageCount()).toBe(1);
    const sin = await generarPdfCotizacion({ ...base, condiciones: { ...CONFIG_POR_DEFECTO, comoAceptar: "" } });
    expect(sin.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sin.length).toBeLessThan(con.length);
  });
});
