import { describe, expect, it } from "vitest";
import {
  SEGUIMIENTO_COT_POR_DEFECTO,
  configSchema,
  pistaDeAceptacion,
  productoPrincipal,
  siguienteToque,
  textoDeSeguimiento,
  toqueQueToca,
} from "@/lib/cotizaciones";

const H = 3_600_000;
const D = 24 * H;
const base = new Date("2026-11-16T15:00:00Z");
const en = (ms: number) => new Date(base.getTime() + ms);
const config = { ...SEGUIMIENTO_COT_POR_DEFECTO, activo: true, plantillaId: "tpl_1" };

describe("seguimiento a cotizaciones sin respuesta", () => {
  // El cliente escribió a las 15:00, la cotización salió a las 15:30.
  const entrada = (ahora: Date, extra: Partial<Parameters<typeof toqueQueToca>[0]> = {}) => ({
    ahora,
    enviadaEn: en(H / 2),
    ultimoDelCliente: base,
    hechos: [],
    config,
    ...extra,
  });

  it("apagado: nada", () => {
    expect(toqueQueToca(entrada(en(22.5 * H), { config: { ...config, activo: false } }))).toBeNull();
  });

  it("el texto sale 2 h antes de que cierre la ventana, no antes", () => {
    expect(toqueQueToca(entrada(en(21 * H)))).toBeNull();
    expect(toqueQueToca(entrada(en(22.5 * H)))).toBe("texto");
    // Con la ventana ya casi cerrada, no se arriesga.
    expect(toqueQueToca(entrada(en(23.97 * H)))).toBeNull();
  });

  it("si el cliente escribió después de la cotización, nunca", () => {
    expect(toqueQueToca(entrada(en(22.5 * H), { ultimoDelCliente: en(H) }))).toBeNull();
  });

  it("la plantilla sale a los N días de enviada y solo dentro de la gracia", () => {
    const hechos = [{ toque: "texto" as const, en: en(22 * H) }];
    expect(toqueQueToca(entrada(en(2 * D), { hechos }))).toBeNull();
    expect(toqueQueToca(entrada(en(3 * D + H), { hechos }))).toBe("plantilla");
    expect(toqueQueToca(entrada(en(6 * D), { hechos }))).toBeNull();
  });

  it("sin plantilla elegida solo hay recordatorio de texto", () => {
    const sinPlantilla = { ...config, plantillaId: null };
    const hechos = [{ toque: "texto" as const, en: en(22 * H) }];
    expect(toqueQueToca(entrada(en(3 * D + H), { hechos, config: sinPlantilla }))).toBeNull();
    expect(siguienteToque(entrada(en(23 * H), { hechos, config: sinPlantilla }))).toBeNull();
  });

  it("si la cotización salió tarde en la ventana, el texto espera 3 h tras el envío", () => {
    // Cotización a las 21 h del último mensaje: 3 h después ya cerró la ventana → sin texto.
    const tarde = { enviadaEn: en(21 * H) };
    expect(toqueQueToca(entrada(en(23 * H), tarde))).toBeNull();
    expect(siguienteToque(entrada(en(22 * H), tarde))?.toque).toBe("plantilla");
  });

  it("siguiente: dice cuál y cuándo", () => {
    const s = siguienteToque(entrada(en(2 * H)));
    expect(s?.toque).toBe("texto");
    expect(s?.fecha.toISOString()).toBe(en(22 * H).toISOString());
  });

  it("la configuración vieja (sin seguimiento) se lee con los valores por defecto", () => {
    const c = configSchema.parse({});
    expect(c.seguimiento.activo).toBe(false);
    expect(c.seguimiento.dias).toBe(3);
    expect(c.detectarSi).toBe(true);
  });

  it("texto y producto del recordatorio", () => {
    const producto = productoPrincipal([
      { concepto: "Instalación", cantidad: 1, precio: 5000 },
      { concepto: "Domo Mini", cantidad: 1, precio: 80000 },
    ]);
    expect(producto).toBe("Domo Mini");
    expect(
      textoDeSeguimiento("Hola {nombre}, ¿pudiste revisar la cotización de {producto} ({folio})?", {
        nombre: "Saúl Garza — Domos Garza",
        producto,
        folio: "COT-0004",
      })
    ).toBe("Hola Saúl, ¿pudiste revisar la cotización de Domo Mini (COT-0004)?");
  });
});

describe("el «sí» del cliente", () => {
  it.each([
    ["Va, lo quiero", "fuerte"],
    ["¿A qué cuenta te deposito?", "fuerte"],
    ["pásame la CLABE", "fuerte"],
    ["Me lo llevo", "fuerte"],
    ["Ya te transferí el anticipo", "fuerte"],
    ["ok", "debil"],
    ["Sí", "debil"],
    ["perfecto, ¿cuándo me lo instalan?", "debil"],
  ])("«%s» → %s", (texto, esperado) => {
    expect(pistaDeAceptacion(texto)).toBe(esperado);
  });

  it.each(["No lo quiero, gracias", "Está muy caro", "Todavía no, lo voy a pensar", "¿De qué material es?", ""])(
    "«%s» no es un sí",
    (texto) => {
      expect(pistaDeAceptacion(texto)).toBeNull();
    }
  );
});
