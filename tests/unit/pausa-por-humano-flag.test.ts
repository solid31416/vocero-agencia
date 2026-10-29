import { describe, expect, it } from "vitest";
import { parsePausaPorHumanoFlag } from "@/server/inbox/pausa-por-humano-flag";

/**
 * Módulo de la agencia — la bandera de la pausa por humano. Lo que importa es
 * el DEFAULT: una instancia que no la pidió se porta igual que el Vocero raíz.
 */

describe("parsePausaPorHumanoFlag", () => {
  it("sin variable, el módulo está apagado", () => {
    expect(parsePausaPorHumanoFlag(undefined)).toBe(false);
    expect(parsePausaPorHumanoFlag("")).toBe(false);
    expect(parsePausaPorHumanoFlag("   ")).toBe(false);
  });

  it("`on` lo enciende, con espacios y mayúsculas de por medio", () => {
    expect(parsePausaPorHumanoFlag("on")).toBe(true);
    expect(parsePausaPorHumanoFlag("ON")).toBe(true);
    expect(parsePausaPorHumanoFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    for (const v of ["1", "true", "TRUE", "si", "sí", "yes"]) {
      expect(parsePausaPorHumanoFlag(v)).toBe(true);
    }
  });

  it("cualquier otra cosa lo deja apagado, incluido `off` y un typo", () => {
    for (const v of ["off", "false", "0", "no", "onn"]) {
      expect(parsePausaPorHumanoFlag(v)).toBe(false);
    }
  });
});
