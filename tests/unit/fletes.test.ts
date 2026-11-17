import { describe, expect, it } from "vitest";
import {
  conceptoDeFlete,
  configFletesSchema,
  destinosConTarifa,
  envioAtrasado,
  estadoCanonico,
  opcionesDeFlete,
} from "@/lib/fletes";

/** Módulo de la agencia — Fletes: transportistas, tabulador y envíos. */

const config = configFletesSchema.parse({
  origen: "Apodaca, Nuevo León",
  transportistas: [
    { id: "tr_a", nombre: "Transportes Águila" },
    { id: "tr_b", nombre: "Fletes Norte", activa: true },
    { id: "tr_c", nombre: "Pausada", activa: false },
  ],
  tarifas: [
    { id: "t1", transportistaId: "tr_a", estado: "Nuevo León", desde: 1, hasta: 3, costo: 8000, precio: 10000, actualizada: "2026-11-01" },
    { id: "t2", transportistaId: "tr_b", estado: "Nuevo León", ciudad: "Allende", desde: 1, hasta: 5, costo: 9000, precio: 12000, actualizada: "2026-11-01" },
    { id: "t3", transportistaId: "tr_a", estado: "Jalisco", desde: 1, hasta: 10, modo: "pieza", costo: 6000, precio: 7500, actualizada: "2026-08-01" },
    { id: "t4", transportistaId: "tr_c", estado: "Jalisco", desde: 1, hasta: 10, costo: 1, precio: 2 },
    { id: "t5", transportistaId: null, estado: "Coahuila", desde: 1, hasta: 10, costo: 0, precio: 0 },
  ],
});
const hoy = "2026-11-17";

describe("fletes", () => {
  it("reconoce el estado como lo escriba la gente", () => {
    expect(estadoCanonico("NL")).toBe("Nuevo León");
    expect(estadoCanonico("n.l.")).toBe("Nuevo León");
    expect(estadoCanonico("nuevo leon")).toBe("Nuevo León");
    expect(estadoCanonico("CDMX")).toBe("Ciudad de México");
    expect(estadoCanonico("Narnia")).toBe("");
  });

  it("la ciudad exacta gana a la del estado, y fuera del rango no aplica", () => {
    const allende = opcionesDeFlete(config, { estado: "N.L.", ciudad: "allende", piezas: 2 }, hoy);
    expect(allende.map((o) => o.tarifaId)).toEqual(["t2", "t1"]);
    expect(allende[0]).toMatchObject({ precio: 12000, costo: 9000, margen: 3000, deCiudad: true, transportista: "Fletes Norte" });
    // 4 piezas: la del estado (1 a 3) ya no aplica.
    expect(opcionesDeFlete(config, { estado: "Nuevo León", ciudad: "Allende", piezas: 4 }, hoy).map((o) => o.tarifaId)).toEqual(["t2"]);
    // Otra ciudad: solo la del estado.
    expect(opcionesDeFlete(config, { estado: "Nuevo León", ciudad: "Monterrey", piezas: 1 }, hoy).map((o) => o.tarifaId)).toEqual(["t1"]);
  });

  it("por pieza multiplica; transportista pausada o sin precio no cuenta; marca la tarifa vieja", () => {
    const jal = opcionesDeFlete(config, { estado: "Jalisco", piezas: 3 }, hoy);
    expect(jal).toHaveLength(1);
    expect(jal[0]).toMatchObject({ precio: 22500, costo: 18000, margen: 4500, vieja: true });
    expect(opcionesDeFlete(config, { estado: "Coahuila", piezas: 1 }, hoy)).toEqual([]);
    expect(opcionesDeFlete(config, { estado: "Nuevo León", piezas: 1 }, hoy)[0]?.vieja).toBe(false);
  });

  it("el agente solo ve destinos, sin precios ni transportistas", () => {
    expect(destinosConTarifa(config)).toEqual(["Allende, Nuevo León", "Todo Jalisco", "Todo Nuevo León"]);
  });

  it("el concepto de la partida", () => {
    expect(conceptoDeFlete({ piezas: 3 }, { estado: "nl", ciudad: "Allende" }, "Apodaca, Nuevo León")).toBe(
      "Flete Apodaca, Nuevo León → Allende, Nuevo León (3 piezas)"
    );
  });

  it("no acepta una tarifa de una transportista que no existe ni un rango al revés", () => {
    expect(configFletesSchema.safeParse({ tarifas: [{ id: "x", transportistaId: "nadie", estado: "Jalisco" }] }).success).toBe(false);
    expect(configFletesSchema.safeParse({ tarifas: [{ id: "x", estado: "Jalisco", desde: 5, hasta: 2 }] }).success).toBe(false);
  });

  it("un envío atrasado", () => {
    expect(envioAtrasado({ estado: "en_camino", entregaEstimada: "2026-11-10" }, hoy)).toBe(true);
    expect(envioAtrasado({ estado: "entregado", entregaEstimada: "2026-11-10" }, hoy)).toBe(false);
    expect(envioAtrasado({ estado: "programado", entregaEstimada: "2026-11-20" }, hoy)).toBe(false);
  });
});
