import { describe, expect, it } from "vitest";
import { CONFIG_POR_DEFECTO, configSchema, productoSchema } from "@/lib/cotizaciones";
import { piezasDelPedido, revisarPedidoDelAgente, VENDEDOR_POR_DEFECTO, vendedorSchema, type ConfigVendedor } from "@/lib/vendedor";

/** Módulo de la agencia — el agente como vendedor: precios del catálogo y límites del dueño. */

const productos = [
  productoSchema.parse({ id: "mini", nombre: "Domo Modelo Mini", precio: 125000 }),
  productoSchema.parse({ id: "arco", nombre: "Domo Modelo Arco", precio: 0 }),
  productoSchema.parse({ id: "flete", nombre: "Flete desde Apodaca", precio: 12000, extra: true }),
];
const opciones = { ivaPct: 16, preciosConIva: false, anticipoPct: 50 };
const activo: ConfigVendedor = { ...VENDEDOR_POR_DEFECTO, activo: true };
const pedir = (items: { productoId: string; cantidad: number }[], descuentoPct = 0, v = activo) =>
  revisarPedidoDelAgente({ items, descuentoPct }, productos, v, opciones);

describe("vendedor", () => {
  it("viene apagado, con tope, cantidad máxima, sin descuento ni extras, y te avisa antes de mandar", () => {
    expect(VENDEDOR_POR_DEFECTO).toMatchObject({
      activo: false,
      modoEnvio: "aprobar",
      extras: { activo: false },
      descuento: { activo: false },
      tope: { activo: true, monto: 1_000_000 },
      cantidadMax: { activo: true, piezas: 5 },
    });
    const { vendedor: _v, ...vieja } = CONFIG_POR_DEFECTO;
    void _v;
    expect(configSchema.parse(vieja).vendedor.activo).toBe(false);
    expect(vendedorSchema.safeParse({ descuento: { activo: true, maxPct: 80 } }).success).toBe(false);
  });

  it("el precio sale del catálogo, nunca del agente", () => {
    const r = pedir([
      { productoId: "mini", cantidad: 2 },
      { productoId: "mini", cantidad: 1 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.partidas).toEqual([expect.objectContaining({ productoId: "mini", cantidad: 3, precio: 125000 })]);
    expect(r.totales.total).toBe(435000);
    expect(r.totales.anticipo).toBe(217500);
  });

  it("apagado, no cotiza", () => {
    expect(pedir([{ productoId: "mini", cantidad: 1 }], 0, VENDEDOR_POR_DEFECTO)).toMatchObject({
      ok: false,
      codigo: "vendedor_apagado",
      paraPersona: true,
    });
  });

  it("producto que no existe o sin precio", () => {
    expect(pedir([{ productoId: "otro", cantidad: 1 }])).toMatchObject({ codigo: "producto_desconocido", paraPersona: false });
    expect(pedir([{ productoId: "arco", cantidad: 1 }])).toMatchObject({ codigo: "sin_precio", paraPersona: true });
  });

  it("el flete solo con permiso, y no cuenta como pieza", () => {
    expect(pedir([{ productoId: "flete", cantidad: 1 }])).toMatchObject({ codigo: "extras_apagados", paraPersona: false });
    const conExtras = { ...activo, extras: { activo: true } };
    const r = pedir(
      [
        { productoId: "mini", cantidad: 5 },
        { productoId: "flete", cantidad: 3 },
      ],
      0,
      { ...conExtras, tope: { activo: false, monto: 1 } }
    );
    expect(r.ok).toBe(true);
  });

  it("más piezas que el máximo o más que el tope: una persona", () => {
    expect(pedir([{ productoId: "mini", cantidad: 6 }])).toMatchObject({ codigo: "cantidad_maxima", paraPersona: true });
    expect(pedir([{ productoId: "mini", cantidad: 6 }], 0, { ...activo, cantidadMax: { activo: false, piezas: 5 }, tope: { activo: true, monto: 500_000 } })).toMatchObject({
      codigo: "tope",
      paraPersona: true,
    });
    const sinLimites = { ...activo, cantidadMax: { activo: false, piezas: 5 }, tope: { activo: false, monto: 1 } };
    expect(pedir([{ productoId: "mini", cantidad: 20 }], 0, sinLimites).ok).toBe(true);
  });

  it("descuento solo con permiso y hasta su máximo", () => {
    expect(pedir([{ productoId: "mini", cantidad: 1 }], 5)).toMatchObject({ codigo: "descuento_no_permitido" });
    const conDescuento = { ...activo, descuento: { activo: true, maxPct: 5 } };
    expect(pedir([{ productoId: "mini", cantidad: 1 }], 10, conDescuento)).toMatchObject({ codigo: "descuento_alto" });
    const r = pedir([{ productoId: "mini", cantidad: 1 }], 5, conDescuento);
    expect(r.ok && r.totales.descuento).toBe(6250);
  });
  it("el flete del tabulador entra a la cotización, sin el flete genérico del catálogo, y cuenta para el tope", () => {
    const flete = { productoId: null, concepto: "Flete a Allende", descripcion: "", cantidad: 1, unidad: "servicio", precio: 15000 };
    const conExtras = { ...activo, extras: { activo: true } };
    const r = revisarPedidoDelAgente(
      { items: [{ productoId: "mini", cantidad: 2 }, { productoId: "flete", cantidad: 1 }], descuentoPct: 0 },
      productos,
      conExtras,
      opciones,
      flete
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.partidas.map((p) => p.concepto)).toEqual(["Domo Modelo Mini", "Flete a Allende"]);
    expect(r.totales.subtotal).toBe(265000);
    const topeJusto = { ...conExtras, tope: { activo: true, monto: 300000 } };
    expect(
      revisarPedidoDelAgente({ items: [{ productoId: "mini", cantidad: 2 }], descuentoPct: 0 }, productos, topeJusto, opciones, flete)
    ).toMatchObject({ codigo: "tope" });
    expect(piezasDelPedido({ items: [{ productoId: "mini", cantidad: 2 }, { productoId: "flete", cantidad: 3 }] }, productos)).toBe(2);
  });
});
