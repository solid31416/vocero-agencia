import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  PLANTILLA_SUGERIDA,
  armarTexto,
  avisosVencidos,
  configSchema,
  describirAviso,
  fechaYHora,
  primerNombre,
  variablesPlantilla,
} from "@/lib/recordatorios";
import { countVariables } from "@/server/whatsapp/templates";

const MIN = 60_000;

describe("describirAviso", () => {
  it("días, horas y minutos en español", () => {
    expect(describirAviso(1440)).toBe("1 día antes");
    expect(describirAviso(2880)).toBe("2 días antes");
    expect(describirAviso(60)).toBe("1 hora antes");
    expect(describirAviso(180)).toBe("3 horas antes");
    expect(describirAviso(30)).toBe("30 minutos antes");
    expect(describirAviso(1500)).toBe("1 día y 1 hora antes");
    expect(describirAviso(1501)).toBe("1 día, 1 hora y 1 minuto antes");
  });
});

describe("armarTexto", () => {
  const v = { nombre: "Ana", fecha: "viernes 6 de noviembre", hora: "10:00 a.m.", enlace: null };
  it("rellena los campos y quita el enlace si no hay", () => {
    expect(armarTexto("Hola {nombre}, tu cita es el {fecha} a las {hora}.{enlace} Gracias", v)).toBe(
      "Hola Ana, tu cita es el viernes 6 de noviembre a las 10:00 a.m. Gracias"
    );
  });
  it("pone el enlace cuando la cita lo trae", () => {
    expect(armarTexto("Cita a las {hora}.{enlace}", { ...v, enlace: "https://meet.x/abc" })).toBe(
      "Cita a las 10:00 a.m. Enlace de la reunión: https://meet.x/abc"
    );
  });
  it("sin nombre no deja «Hola ,»", () => {
    expect(armarTexto("Hola {nombre}, te esperamos", { ...v, nombre: "" })).toBe("Hola, te esperamos");
  });
  it("el texto por defecto queda limpio", () => {
    const t = armarTexto(CONFIG_POR_DEFECTO.texto, v);
    expect(t).not.toMatch(/[{}]/);
    expect(t).not.toMatch(/ {2}/);
  });
});

describe("primerNombre", () => {
  it("el primer nombre, sin prefijo de prueba ni teléfonos", () => {
    expect(primerNombre("Ana María López")).toBe("Ana");
    expect(primerNombre("[Prueba] Luis")).toBe("Luis");
    expect(primerNombre("+52 81 1234 5678")).toBe("");
    expect(primerNombre(null)).toBe("");
  });
});

describe("avisosVencidos", () => {
  const cita = new Date("2026-11-06T16:00:00Z");
  const a = (minAntes: number) => new Date(cita.getTime() - minAntes * MIN);

  it("toca justo al llegar el momento y dentro de la gracia", () => {
    expect(avisosVencidos(a(1440), cita, [1440, 60])).toEqual([1440]);
    expect(avisosVencidos(a(1430), cita, [1440, 60])).toEqual([1440]);
    expect(avisosVencidos(a(60), cita, [1440, 60])).toEqual([60]);
  });
  it("antes de tiempo no toca", () => {
    expect(avisosVencidos(a(1441), cita, [1440])).toEqual([]);
  });
  it("pasada la gracia ya no se manda (cita agendada tarde)", () => {
    expect(avisosVencidos(a(20), cita, [1440, 60])).toEqual([]);
  });
  it("una cita ya pasada no recibe nada", () => {
    expect(avisosVencidos(new Date(cita.getTime() + MIN), cita, [5])).toEqual([]);
  });
});

describe("configSchema", () => {
  it("quita repetidos y ordena de mayor a menor", () => {
    const r = configSchema.parse({ ...CONFIG_POR_DEFECTO, avisos: [60, 1440, 60] });
    expect(r.avisos).toEqual([1440, 60]);
  });
  it("rechaza avisos fuera de rango o de más", () => {
    expect(configSchema.safeParse({ ...CONFIG_POR_DEFECTO, avisos: [2] }).success).toBe(false);
    expect(configSchema.safeParse({ ...CONFIG_POR_DEFECTO, avisos: [20000] }).success).toBe(false);
    expect(configSchema.safeParse({ ...CONFIG_POR_DEFECTO, avisos: [10, 20, 30, 40] }).success).toBe(false);
  });
  it("exige mensaje", () => {
    expect(configSchema.safeParse({ ...CONFIG_POR_DEFECTO, texto: "  " }).success).toBe(false);
  });
});

describe("plantilla", () => {
  it("la sugerida usa 3 variables y le alcanzan las que mandamos", () => {
    expect(countVariables(PLANTILLA_SUGERIDA)).toBe(3);
    const vars = variablesPlantilla({ nombre: "", fecha: "f", hora: "h", enlace: null });
    expect(vars.length).toBeGreaterThanOrEqual(3);
    expect(vars[0]).not.toBe("");
  });
});

describe("fechaYHora", () => {
  it("en la zona del negocio", () => {
    const { fecha, hora } = fechaYHora(new Date("2026-11-06T16:00:00Z"), "America/Mexico_City");
    expect(fecha).toMatch(/viernes/);
    expect(fecha).toMatch(/noviembre/);
    expect(hora).toMatch(/^10:00/);
  });
});
