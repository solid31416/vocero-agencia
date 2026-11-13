import { describe, expect, it } from "vitest";
import { ajustarNumero, numeroAlSalir, textoANumero } from "@/lib/numero";

describe("campos de número que se dejan escribir", () => {
  it("vacío o a medias no es un número (no se convierte en 0)", () => {
    expect(textoANumero("")).toBeNull();
    expect(textoANumero("  ")).toBeNull();
    expect(textoANumero("-")).toBeNull();
    expect(textoANumero("2")).toBe(2);
    expect(textoANumero("1.5")).toBe(1.5);
    expect(textoANumero("1.")).toBe(1);
  });

  it("al salir vacío toma `vacio`, si no `min`, si no 0", () => {
    expect(numeroAlSalir("", { min: 1 })).toBe(1);
    expect(numeroAlSalir("", { min: 1, vacio: 3 })).toBe(3);
    expect(numeroAlSalir("", {})).toBe(0);
  });

  it("al salir respeta límites y enteros", () => {
    expect(numeroAlSalir("0", { min: 1 })).toBe(1);
    expect(numeroAlSalir("150", { min: 0, max: 100 })).toBe(100);
    expect(numeroAlSalir("7.6", { entero: true, min: 1 })).toBe(8);
    expect(ajustarNumero(2, { min: 1 })).toBe(2);
  });
});
