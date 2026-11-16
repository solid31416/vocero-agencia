import { describe, expect, it } from "vitest";
import { clavesDeProductos, esDelProducto, menciona, porcentajeCierre } from "@/lib/por-modelo";

const productos = [
  { id: "p1", nombre: "Domo Mini" },
  { id: "p2", nombre: "Domo Modelo Estándar" },
  { id: "p3", nombre: "Contenedor 20 pies" },
];

describe("resultados por modelo", () => {
  const claves = clavesDeProductos(productos);

  it("cada producto se reconoce por lo que lo distingue", () => {
    expect(claves.get("p1")).toEqual(["mini"]);
    expect(claves.get("p2")).toEqual(["estandar"]);
    expect(claves.get("p3")).toEqual(["contenedor", "pies"]);
  });

  it("menciones del cliente", () => {
    expect(menciona("¿Cuánto cuesta el mini?", claves.get("p1")!)).toBe(true);
    expect(menciona("Me interesa el ESTÁNDAR", claves.get("p2")!)).toBe(true);
    // «domo» solo no dice cuál.
    expect(menciona("info del domo porfa", claves.get("p1")!)).toBe(false);
    // Palabra completa, no pedazos.
    expect(menciona("minimo cuánto", claves.get("p1")!)).toBe(false);
  });

  it("un solo producto se reconoce por su nombre", () => {
    const solo = clavesDeProductos([{ id: "x", nombre: "Domo Geodésico" }]);
    expect(menciona("quiero un domo", solo.get("x")!)).toBe(true);
  });

  it("partidas: manda el producto de la lista; si es libre, el nombre", () => {
    expect(esDelProducto({ productoId: "p1", concepto: "Lo que sea" }, productos[0]!, claves.get("p1")!)).toBe(true);
    expect(esDelProducto({ productoId: "p2", concepto: "Domo Mini" }, productos[0]!, claves.get("p1")!)).toBe(false);
    expect(esDelProducto({ productoId: null, concepto: "Domo mini con baño" }, productos[0]!, claves.get("p1")!)).toBe(true);
    expect(esDelProducto({ productoId: null, concepto: "Instalación" }, productos[0]!, claves.get("p1")!)).toBe(false);
  });

  it("% de cierre", () => {
    expect(porcentajeCierre(1, 3)).toBe(33);
    expect(porcentajeCierre(0, 0)).toBeNull();
  });
});
