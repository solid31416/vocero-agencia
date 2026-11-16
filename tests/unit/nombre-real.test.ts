import { afterEach, describe, expect, it } from "vitest";
import { aNombreDe, nombreDeLaFicha, nombreRealEnabled, nombreUtil } from "@/server/nombre-real";

describe("nombre real del cliente", () => {
  const antes = process.env.NOMBRE_REAL;
  afterEach(() => {
    process.env.NOMBRE_REAL = antes;
  });

  it("apagado por defecto", () => {
    delete process.env.NOMBRE_REAL;
    expect(nombreRealEnabled()).toBe(false);
    process.env.NOMBRE_REAL = "on";
    expect(nombreRealEnabled()).toBe(true);
  });

  it("una letra o puros signos no sirven de nombre", () => {
    expect(nombreUtil("J")).toBeNull();
    expect(nombreUtil("  ")).toBeNull();
    expect(nombreUtil("🙂🙂")).toBeNull();
    expect(nombreUtil(42)).toBeNull();
    expect(nombreUtil("  Saúl   Garza ")).toBe("Saúl Garza");
  });

  it("el nombre que dio el cliente gana; si solo dio la empresa, la empresa", () => {
    expect(nombreDeLaFicha({ nombre: "Saúl Garza", empresa: "Domos del Norte" })).toBe("Saúl Garza");
    expect(nombreDeLaFicha({ empresa: "Domos del Norte" })).toBe("Domos del Norte");
    expect(nombreDeLaFicha({ geo: "Allende" })).toBeNull();
    expect(nombreDeLaFicha(null)).toBeNull();
  });

  it("a nombre de quién va la cotización", () => {
    expect(aNombreDe({ nombre: "Saúl Garza", empresa: "Domos del Norte" }, "J")).toBe("Saúl Garza — Domos del Norte");
    expect(aNombreDe({ nombre: "Saúl Garza" }, "J")).toBe("Saúl Garza");
    expect(aNombreDe({ empresa: "Domos del Norte" }, "Saúl")).toBe("Saúl — Domos del Norte");
    expect(aNombreDe(null, "J")).toBe("J");
    expect(aNombreDe({ nombre: "Domos SA", empresa: "domos sa" }, "J")).toBe("Domos SA");
  });
});
