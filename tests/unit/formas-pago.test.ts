import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { CONFIG_POR_DEFECTO, calcularTotales, configSchema, metodoPagoSchema, renglonesDePago } from "@/lib/cotizaciones";
import { generarPdfCotizacion } from "@/server/cotizaciones/pdf";

/** Módulo de la agencia — formas de pago escritas a mano que salen en el PDF («Cómo pagar»). */

describe("formas de pago", () => {
  it("solo el nombre es obligatorio; la CLABE se guarda sin espacios y con 18 números", () => {
    const m = metodoPagoSchema.parse({ id: "mp_1", nombre: "Transferencia BBVA", clabe: "0121 8000 1234 5678 90" });
    expect(m).toMatchObject({ banco: "", titular: "", clabe: "012180001234567890", cuenta: "", tarjeta: "", notas: "" });
    expect(metodoPagoSchema.safeParse({ id: "mp_1", nombre: "X", clabe: "1234" }).success).toBe(false);
    expect(metodoPagoSchema.safeParse({ id: "mp_1", nombre: "" }).success).toBe(false);
    expect(metodoPagoSchema.parse({ id: "mp_1", nombre: "Efectivo en showroom" }).clabe).toBe("");
  });

  it("una configuración vieja (sin formas de pago) sigue sirviendo", () => {
    expect(CONFIG_POR_DEFECTO.metodosPago).toEqual([]);
    const { metodosPago: _m, ...vieja } = CONFIG_POR_DEFECTO;
    void _m;
    expect(configSchema.parse(vieja).metodosPago).toEqual([]);
  });

  it("los renglones de «Cómo pagar» solo traen lo que se llenó", () => {
    const m = metodoPagoSchema.parse({
      id: "mp_1",
      nombre: "Transferencia BBVA",
      banco: "BBVA",
      titular: "Wis Dome House México",
      clabe: "012180001234567890",
      notas: "Manda tu comprobante por WhatsApp.",
    });
    expect(renglonesDePago(m)).toEqual([
      "Banco: BBVA",
      "A nombre de: Wis Dome House México",
      "CLABE: 012180001234567890",
      "Manda tu comprobante por WhatsApp.",
    ]);
    expect(renglonesDePago(metodoPagoSchema.parse({ id: "x", nombre: "Efectivo" }))).toEqual([]);
  });

  it("el PDF sale con ellas, con muchas (salta de página) y con una cotización vieja sin ellas", async () => {
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
    };
    const metodo = (i: number) =>
      metodoPagoSchema.parse({
        id: `mp_${i}`,
        nombre: `Transferencia ${i}`,
        banco: "BBVA",
        titular: "Wis Dome House México",
        clabe: "012180001234567890",
        cuenta: "0123456789",
        tarjeta: "4152 3138 0000 0000",
        notas: "Pon tu folio como concepto y manda tu comprobante por este WhatsApp.",
      });
    const una = await generarPdfCotizacion({ ...base, condiciones: { ...CONFIG_POR_DEFECTO, metodosPago: [metodo(1)] } });
    expect((await PDFDocument.load(una)).getPageCount()).toBe(1);
    const seis = await generarPdfCotizacion({
      ...base,
      partidas: Array.from({ length: 12 }, () => partidas[0]!),
      condiciones: { ...CONFIG_POR_DEFECTO, metodosPago: [1, 2, 3, 4, 5, 6].map(metodo) },
    });
    expect((await PDFDocument.load(seis)).getPageCount()).toBeGreaterThan(1);
    const { metodosPago: _m, ...vieja } = CONFIG_POR_DEFECTO;
    void _m;
    const sin = await generarPdfCotizacion({ ...base, condiciones: vieja as typeof CONFIG_POR_DEFECTO });
    expect(sin.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
