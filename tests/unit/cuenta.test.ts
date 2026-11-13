import { describe, expect, it } from "vitest";
import { MIN_CONTRASENA, mensajeDeError, problemaDelCambio } from "@/lib/cuenta";
import { settingsSections } from "@/lib/nav";

describe("cuenta — cambiar contraseña", () => {
  const ok = { actual: "vieja-123", nueva: "nueva-segura-1", confirmar: "nueva-segura-1" };

  it("deja pasar un cambio correcto", () => {
    expect(problemaDelCambio(ok)).toBeNull();
  });

  it("pide la actual, el mínimo, que sea distinta y que coincida", () => {
    expect(problemaDelCambio({ ...ok, actual: "" })).toMatch(/actual/);
    const corta = "a".repeat(MIN_CONTRASENA - 1);
    expect(problemaDelCambio({ ...ok, nueva: corta, confirmar: corta })).toMatch(/al menos 8/);
    expect(problemaDelCambio({ ...ok, nueva: ok.actual, confirmar: ok.actual })).toMatch(/igual a la actual/);
    expect(problemaDelCambio({ ...ok, confirmar: "otra-cosa-1" })).toMatch(/no coincide/);
    expect(problemaDelCambio({ ...ok, nueva: " con-espacio", confirmar: " con-espacio" })).toMatch(/espacios/);
    const larga = "a".repeat(129);
    expect(problemaDelCambio({ ...ok, nueva: larga, confirmar: larga })).toMatch(/como mucho/);
  });

  it("traduce los errores de Better Auth", () => {
    expect(mensajeDeError("INVALID_PASSWORD")).toBe("La contraseña actual no es correcta.");
    expect(mensajeDeError(undefined)).toMatch(/No se pudo/);
  });

  it("«Tu cuenta» aparece al final solo cuando el layout la pide", () => {
    expect(settingsSections({}).map((s) => s.title)).toEqual(["Canales", "Agente", "Negocio"]);
    const con = settingsSections({ cuenta: true });
    expect(con.map((s) => s.title)).toEqual(["Canales", "Agente", "Negocio", "Tu cuenta"]);
    expect(con.at(-1)?.links).toEqual([{ href: "/settings/cuenta", label: "Contraseña" }]);
  });
});
