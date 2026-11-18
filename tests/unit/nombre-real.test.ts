import { afterEach, describe, expect, it } from "vitest";
import { aNombreDe, nombreDeLaFicha, nombreRealEnabled, nombreUtil } from "@/server/nombre-real";
import { armarMensaje, nombreParaSaludo } from "@/lib/cotizaciones";

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
    expect(nombreDeLaFicha({ nombre: "Saúl Garza", empresa: "Domos del Norte" })).toBe("Domos del Norte (Saúl Garza)");
    expect(nombreDeLaFicha({ empresa: "Domos del Norte" })).toBe("Domos del Norte");
    expect(nombreDeLaFicha({ geo: "Allende" })).toBeNull();
    expect(nombreDeLaFicha(null)).toBeNull();
  });

  it("a nombre de quién va la cotización", () => {
    expect(aNombreDe({ nombre: "Saúl Garza", empresa: "Domos del Norte" }, "J")).toBe("Domos del Norte (Saúl Garza)");
    expect(aNombreDe({ nombre: "Saúl Garza" }, "J")).toBe("Saúl Garza");
    expect(aNombreDe({ empresa: "Domos del Norte" }, "Saúl")).toBe("Domos del Norte (Saúl)");
    expect(aNombreDe(null, "J")).toBe("J");
    expect(aNombreDe({ nombre: "Domos SA", empresa: "domos sa" }, "J")).toBe("Domos SA");
  });
});

describe("Módulo de la agencia — «Empresa (Persona)»", () => {
  it("arma el nombre como lo quiere ver el dueño", () => {
    expect(nombreDeLaFicha({ nombre: "Saúl", empresa: "Domos Garza" })).toBe("Domos Garza (Saúl)");
    expect(nombreDeLaFicha({ nombre: "Perla", empresa: "Casas y Cabañas" })).toBe("Casas y Cabañas (Perla)");
    // Misma cosa en los dos campos, o ya viene armado: no se repite.
    expect(nombreDeLaFicha({ nombre: "Domos Garza", empresa: "Domos Garza" })).toBe("Domos Garza");
    expect(nombreDeLaFicha({ nombre: "Domos Garza (Saúl)", empresa: "Domos Garza" })).toBe("Domos Garza (Saúl)");
  });

  it("el saludo del PDF es con la persona, no con la empresa", () => {
    expect(nombreParaSaludo("Domos Garza (Saúl)")).toBe("Saúl");
    expect(nombreParaSaludo("Casas y Cabañas (Perla Valdez)")).toBe("Perla");
    expect(nombreParaSaludo("Saúl Garza")).toBe("Saúl");
    expect(
      armarMensaje("Hola {nombre}, te comparto tu cotización {folio}.", { nombre: "Domos Garza (Saúl)", folio: "COT-1", total: "", vigencia: "" })
    ).toBe("Hola Saúl, te comparto tu cotización COT-1.");
  });
});
