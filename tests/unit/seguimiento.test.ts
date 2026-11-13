import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  armarVariables,
  configSchema,
  describirDias,
  pasoQueToca,
  siguientePaso,
  venceEn,
  type Paso,
} from "@/lib/seguimiento";
import { settingsSections } from "@/lib/nav";
import { seguimientoEnabled } from "@/server/seguimiento/flag";

const DIA = 86_400_000;
const HORA = 3_600_000;
const ancla = new Date("2026-11-01T18:00:00Z");
const pasos: Paso[] = [
  { dias: 3, plantillaId: "t3", variables: ["{nombre}"] },
  { dias: 7, plantillaId: "t7", variables: ["{nombre}"] },
  { dias: 30, plantillaId: "t30", variables: ["{nombre}"] },
];
const en = (ms: number) => new Date(ancla.getTime() + ms);

describe("seguimiento — qué paso toca", () => {
  it("nada antes de los 3 días", () => {
    expect(pasoQueToca(en(3 * DIA - 1), ancla, pasos, [])).toBeNull();
  });

  it("el de 3 días al cumplirse, y no dos veces", () => {
    expect(pasoQueToca(en(3 * DIA + HORA), ancla, pasos, [])?.dias).toBe(3);
    expect(pasoQueToca(en(3 * DIA + HORA), ancla, pasos, [3])).toBeNull();
  });

  it("el de 7 días después del de 3", () => {
    expect(pasoQueToca(en(7 * DIA + 5 * 60_000), ancla, pasos, [3])?.dias).toBe(7);
  });

  it("un paso vencido hace más de 2 días ya no sale (pláticas viejas al encender)", () => {
    expect(pasoQueToca(en(3 * DIA + 49 * HORA), ancla, pasos, [])).toBeNull();
    expect(pasoQueToca(en(40 * DIA), ancla, pasos, [])).toBeNull();
  });

  it("si se juntan dos, sale solo el más tardío", () => {
    const juntos: Paso[] = [
      { dias: 1, plantillaId: "a", variables: [] },
      { dias: 2, plantillaId: "b", variables: [] },
    ];
    expect(pasoQueToca(en(2 * DIA + HORA), ancla, juntos, [])?.dias).toBe(2);
    // y el de 1 día ya no sale después
    expect(pasoQueToca(en(2 * DIA + 2 * HORA), ancla, juntos, [2])).toBeNull();
  });

  it("el siguiente paso para la bandeja", () => {
    expect(siguientePaso(en(DIA), ancla, pasos, [])).toEqual({ dias: 3, fecha: venceEn(ancla, 3) });
    expect(siguientePaso(en(4 * DIA), ancla, pasos, [3])?.dias).toBe(7);
    expect(siguientePaso(en(31 * DIA), ancla, pasos, [3, 7, 30])).toBeNull();
    // se saltó el de 3 (revisor apagado): el siguiente es el de 7
    expect(siguientePaso(en(6 * DIA), ancla, pasos, [])?.dias).toBe(7);
  });
});

describe("seguimiento — configuración y textos", () => {
  it("por defecto: apagado, 3/7/30 días, sin plantillas", () => {
    expect(CONFIG_POR_DEFECTO.activo).toBe(false);
    expect(CONFIG_POR_DEFECTO.pasos.map((p) => p.dias)).toEqual([3, 7, 30]);
    expect(CONFIG_POR_DEFECTO.pasos.every((p) => p.plantillaId === null)).toBe(true);
  });

  it("ordena los pasos y rechaza días repetidos o fuera de rango", () => {
    const c = configSchema.parse({ pasos: [{ dias: 10, plantillaId: null, variables: [] }, { dias: 2, plantillaId: null, variables: [] }] });
    expect(c.pasos.map((p) => p.dias)).toEqual([2, 10]);
    expect(configSchema.safeParse({ pasos: [{ dias: 3, variables: [] }, { dias: 3, variables: [] }] }).success).toBe(false);
    expect(configSchema.safeParse({ pasos: [{ dias: 0, variables: [] }] }).success).toBe(false);
    expect(configSchema.safeParse({ pasos: [{ dias: 91, variables: [] }] }).success).toBe(false);
    expect(configSchema.safeParse({ pasos: [] }).success).toBe(false);
    const cuatro = [1, 2, 3, 4].map((d) => ({ dias: d, variables: [] }));
    expect(configSchema.safeParse({ pasos: cuatro }).success).toBe(false);
  });

  it("pone el primer nombre y nunca deja una variable vacía", () => {
    expect(armarVariables(["{nombre}", "tu domo"], "Marcos Pérez")).toEqual(["Marcos", "tu domo"]);
    expect(armarVariables(["{nombre}"], "+52 81 1234 5678")).toEqual(["👋"]);
    expect(armarVariables(["Hola {nombre}"], "")).toEqual(["Hola"]);
  });

  it("días en texto", () => {
    expect(describirDias(1)).toBe("1 día");
    expect(describirDias(30)).toBe("30 días");
  });

  it("Ajustes → Seguimiento solo con la bandera", () => {
    const links = (s: boolean) => settingsSections({ seguimiento: s }).flatMap((x) => x.links.map((l) => l.href));
    expect(links(false)).not.toContain("/settings/seguimiento");
    expect(links(true)).toContain("/settings/seguimiento");
  });
});

describe("seguimiento — bandera", () => {
  const previo = process.env.SEGUIMIENTO_AUTOMATICO;
  afterEach(() => {
    if (previo === undefined) delete process.env.SEGUIMIENTO_AUTOMATICO;
    else process.env.SEGUIMIENTO_AUTOMATICO = previo;
  });
  it("apagada por defecto, encendida con on", () => {
    delete process.env.SEGUIMIENTO_AUTOMATICO;
    expect(seguimientoEnabled()).toBe(false);
    process.env.SEGUIMIENTO_AUTOMATICO = "on";
    expect(seguimientoEnabled()).toBe(true);
  });
});
