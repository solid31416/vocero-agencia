import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  armarMensaje,
  calcularTotales,
  configSchema,
  cotizacionInputSchema,
  estadoVisible,
  folioDe,
  formatoDinero,
  partidasDeSugerencia,
  sugerenciaIaSchema,
  type Producto,
} from "@/lib/cotizaciones";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { generarPdfCotizacion, limpiarTexto, nombreArchivo } from "@/server/cotizaciones/pdf";

const productos: Producto[] = [
  { id: "p1", nombre: "Domo Estándar", precio: 100000, unidad: "pieza", descripcion: "Expansión en dos direcciones" },
  { id: "p2", nombre: "Domo Mini", precio: 65000.5, unidad: "pieza", descripcion: "" },
  { id: "p3", nombre: "Instalación", precio: 15000, unidad: "servicio", descripcion: "" },
];

describe("cotizaciones — totales", () => {
  it("suma, descuenta y agrega IVA encima", () => {
    const t = calcularTotales(
      [
        { cantidad: 4, precio: 100000 },
        { cantidad: 1, precio: 15000 },
      ],
      { descuentoPct: 10, ivaPct: 16, preciosConIva: false, anticipoPct: 50 }
    );
    expect(t.subtotal).toBe(415000);
    expect(t.descuento).toBe(41500);
    expect(t.base).toBe(373500);
    expect(t.iva).toBe(59760);
    expect(t.total).toBe(433260);
    expect(t.anticipo).toBe(216630);
  });

  it("con precios que ya traen IVA, lo desglosa hacia dentro sin cambiar el total", () => {
    const t = calcularTotales([{ cantidad: 1, precio: 116 }], {
      descuentoPct: 0,
      ivaPct: 16,
      preciosConIva: true,
      anticipoPct: 0,
    });
    expect(t.total).toBe(116);
    expect(t.base).toBe(100);
    expect(t.iva).toBe(16);
  });

  it("redondea a centavos", () => {
    const t = calcularTotales([{ cantidad: 3, precio: 65000.5 }], {
      descuentoPct: 0,
      ivaPct: 16,
      preciosConIva: false,
      anticipoPct: 33,
    });
    expect(t.subtotal).toBe(195001.5);
    expect(t.iva).toBe(31200.24);
    expect(t.total).toBe(226201.74);
    expect(t.anticipo).toBe(74646.57);
  });
});

describe("cotizaciones — la IA no pone precios", () => {
  it("usa el precio de la lista aunque la IA mande otra cosa", () => {
    const sug = sugerenciaIaSchema.parse({
      partidas: [
        { productoId: "p1", concepto: "Domo Estándar", cantidad: 4, precio: 1 },
        { productoId: null, concepto: "domo mini", cantidad: 2 },
      ],
      notas: "Valle de Bravo",
    });
    const { partidas, sinPrecio } = partidasDeSugerencia(sug, productos);
    expect(sinPrecio).toBe(0);
    expect(partidas).toEqual([
      expect.objectContaining({ productoId: "p1", precio: 100000, cantidad: 4 }),
      expect.objectContaining({ productoId: "p2", precio: 65000.5, cantidad: 2 }),
    ]);
  });

  it("lo que no está en la lista queda en $0 y marcado sin precio", () => {
    const sug = sugerenciaIaSchema.parse({ partidas: [{ productoId: "zzz", concepto: "Baño integrado", cantidad: 0 }] });
    const { partidas, sinPrecio } = partidasDeSugerencia(sug, productos);
    expect(sinPrecio).toBe(1);
    expect(partidas[0]).toMatchObject({ productoId: null, concepto: "Baño integrado", precio: 0, cantidad: 1 });
    expect(partidas[0]!.descripcion).toContain("sin precio");
  });

  it("una respuesta rara de la IA no truena", () => {
    expect(sugerenciaIaSchema.parse({ partidas: "nada" })).toEqual({ partidas: [], notas: "" });
    expect(partidasDeSugerencia(sugerenciaIaSchema.parse({}), productos).partidas).toEqual([]);
  });
});

describe("cotizaciones — esquemas y textos", () => {
  it("la configuración por defecto es válida y trae IVA 16% y anticipo 50%", () => {
    expect(configSchema.parse({})).toEqual(CONFIG_POR_DEFECTO);
    expect(CONFIG_POR_DEFECTO.ivaPct).toBe(16);
    expect(CONFIG_POR_DEFECTO.anticipoPct).toBe(50);
  });

  it("una cotización necesita al menos una partida y precios no negativos", () => {
    expect(cotizacionInputSchema.safeParse({ conversationId: "c", partidas: [] }).success).toBe(false);
    expect(
      cotizacionInputSchema.safeParse({ conversationId: "c", partidas: [{ concepto: "x", cantidad: 1, precio: -5 }] })
        .success
    ).toBe(false);
    expect(
      cotizacionInputSchema.safeParse({ conversationId: "c", partidas: [{ concepto: "x", cantidad: 2, precio: 5 }] })
        .success
    ).toBe(true);
  });

  it("folio, dinero y mensaje", () => {
    expect(folioDe(7)).toBe("COT-0007");
    expect(folioDe(12345)).toBe("COT-12345");
    expect(formatoDinero(433260)).toBe("$433,260.00");
    expect(formatoDinero(10, "USD")).toBe("US$10.00");
    expect(
      armarMensaje("Hola {nombre}, tu {folio} por {total} vence el {vigencia}.", {
        nombre: "Marcos Pérez",
        folio: "COT-0001",
        total: "$1.00",
        vigencia: "1 de diciembre de 2026",
      })
    ).toBe("Hola Marcos, tu COT-0001 por $1.00 vence el 1 de diciembre de 2026.");
    expect(armarMensaje("Hola {nombre}, ya.", { nombre: "", folio: "", total: "", vigencia: "" })).toBe("Hola, ya.");
  });

  it("una enviada vencida se ve vencida; las demás no cambian", () => {
    const ayer = new Date(Date.now() - 86_400_000);
    expect(estadoVisible("enviada", ayer)).toBe("vencida");
    expect(estadoVisible("aceptada", ayer)).toBe("aceptada");
    expect(estadoVisible("enviada", new Date(Date.now() + 86_400_000))).toBe("enviada");
  });
});

describe("cotizaciones — PDF", () => {
  it("quita lo que Helvetica no sabe dibujar (emojis) y deja acentos y ñ", () => {
    expect(limpiarTexto("Año 🏕️ cañón — ¿sí? ¡ok! “x”")).toBe("Año cañón — ¿sí? ¡ok! “x”");
  });

  it("arma un PDF válido de una página, y de varias con muchas partidas", async () => {
    const base = {
      folio: "COT-0001",
      fecha: new Date("2026-11-12T18:00:00Z"),
      venceEn: new Date("2026-11-27T18:00:00Z"),
      cliente: "Marcos 🏕️ Pérez",
      descuentoPct: 0,
      notas: "Entrega en Valle de Bravo, Estado de México.",
      condiciones: { ...CONFIG_POR_DEFECTO, condiciones: "Instalación en 5 días hábiles." },
      nombreMarca: "Wis Dome House",
      acento: "#0d5bff",
      logo: null,
    };
    const partidas = [
      { productoId: "p1", concepto: "Domo Estándar", descripcion: "Expansión en dos direcciones", cantidad: 4, unidad: "pieza", precio: 100000 },
    ];
    const totales = calcularTotales(partidas, { descuentoPct: 0, ivaPct: 16, preciosConIva: false, anticipoPct: 50 });
    const pdf = await generarPdfCotizacion({ ...base, partidas, totales });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);

    const muchas = Array.from({ length: 50 }, (_, i) => ({ ...partidas[0]!, concepto: `Partida ${i + 1} con un nombre bastante largo para que haga salto de renglón en la tabla` }));
    const pdf2 = await generarPdfCotizacion({
      ...base,
      partidas: muchas,
      totales: calcularTotales(muchas, { descuentoPct: 5, ivaPct: 16, preciosConIva: false, anticipoPct: 50 }),
    });
    expect((await PDFDocument.load(pdf2)).getPageCount()).toBeGreaterThan(1);
  });

  it("un logo dañado no impide la cotización", async () => {
    const partidas = [{ productoId: null, concepto: "X", descripcion: "", cantidad: 1, unidad: "pieza", precio: 10 }];
    const pdf = await generarPdfCotizacion({
      folio: "COT-0002",
      fecha: new Date(),
      venceEn: new Date(),
      cliente: "Cliente",
      partidas,
      descuentoPct: 0,
      notas: "",
      totales: calcularTotales(partidas, { descuentoPct: 0, ivaPct: 0, preciosConIva: false, anticipoPct: 0 }),
      condiciones: CONFIG_POR_DEFECTO,
      nombreMarca: "Negocio",
      acento: "zzz",
      logo: { data: Buffer.from("no soy png"), mime: "image/png" },
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("nombre de archivo sin acentos ni espacios", () => {
    expect(nombreArchivo("COT-0001", "Wis Dome House México")).toBe("Cotizacion-COT-0001-Wis-Dome-House-Mexico.pdf");
    expect(nombreArchivo("COT-0001", "")).toBe("Cotizacion-COT-0001.pdf");
  });
});

describe("cotizaciones — bandera", () => {
  const previo = process.env.COTIZACIONES;
  afterEach(() => {
    if (previo === undefined) delete process.env.COTIZACIONES;
    else process.env.COTIZACIONES = previo;
  });
  it("apagada por defecto, encendida con on", () => {
    delete process.env.COTIZACIONES;
    expect(cotizacionesEnabled()).toBe(false);
    process.env.COTIZACIONES = "on";
    expect(cotizacionesEnabled()).toBe(true);
  });
});
