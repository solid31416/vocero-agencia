import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  GRATIS_SERVICIO,
  TARIFAS_MX,
  categoriaDe,
  claveAviso,
  configSchema,
  hayQueAvisar,
  mesEnZona,
  normalizarCategoria,
  resumirMes,
  sumarReporteMeta,
  textoAviso,
  type FilaMensaje,
} from "@/lib/contador-mensajes";

const base = { dia: 15, diasMes: 30, tarifas: TARIFAS_MX, alertaPct: 80 };
const filas = (cantidad: number, f: Partial<FilaMensaje> = {}): FilaMensaje[] =>
  Array.from({ length: cantidad }, (_, i) => ({ dia: (i % 15) + 1, origen: "ai", categoria: null, tipo: null, ...f }));

describe("normalizarCategoria y categoriaDe", () => {
  it("entiende lo que manda Meta", () => {
    expect(normalizarCategoria("SERVICE")).toBe("service");
    expect(normalizarCategoria("marketing_lite")).toBe("marketing");
    expect(normalizarCategoria("raro")).toBeNull();
    expect(normalizarCategoria(undefined)).toBeNull();
  });
  it("sin dato de Meta: plantilla = Utilidad, lo demás = respuesta", () => {
    expect(categoriaDe({ categoria: null, origen: "template" })).toBe("utility");
    expect(categoriaDe({ categoria: null, origen: "ai" })).toBe("service");
    expect(categoriaDe({ categoria: "marketing", origen: "template" })).toBe("marketing");
  });
});

describe("resumirMes", () => {
  it("un mes tranquilo: todo gratis, estado bien", () => {
    const r = resumirMes([...filas(300), ...filas(10, { origen: "template" })], base);
    expect(r.servicio).toEqual({ usadas: 300, gratis: 300, cobradas: 0 });
    expect(r.plantillas.utility).toBe(10);
    expect(r.costo).toBe(1.57); // 10 × $0.1565, redondeado a centavos
    expect(r.estado).toBe("bien");
    expect(r.porOrigen).toEqual({ nea: 300, personas: 0, plantillas: 10 });
  });

  it("cerca del límite al pasar el porcentaje de aviso", () => {
    expect(resumirMes(filas(800), base).estado).toBe("cerca");
    expect(resumirMes(filas(799), base).estado).toBe("bien");
    expect(resumirMes(filas(700), { ...base, alertaPct: 70 }).estado).toBe("cerca");
  });

  it("pasando las 1,000 se cobran las de más", () => {
    const r = resumirMes(filas(1200), base);
    expect(r.servicio).toEqual({ usadas: 1200, gratis: 1000, cobradas: 200 });
    expect(r.costo).toBeCloseTo(200 * TARIFAS_MX.service, 2);
    expect(r.estado).toBe("cobra");
  });

  it("cuando Meta dice cuáles se cobraron, manda Meta", () => {
    const r = resumirMes(
      [...filas(50, { categoria: "service", tipo: "regular" }), ...filas(100, { categoria: "service", tipo: "free_customer_service" })],
      base
    );
    expect(r.servicio.cobradas).toBe(50);
    expect(r.servicio.gratis).toBe(100);
  });

  it("un fallo de pago manda sobre todo lo demás", () => {
    expect(resumirMes(filas(10), { ...base, fallosPago: 3 }).estado).toBe("no_entrega");
  });

  it("proyecta el fin de mes y el día en que se acaban las gratis", () => {
    const r = resumirMes(filas(600), base); // 40 por día
    expect(r.proyeccion.respuestas).toBe(1200);
    expect(r.proyeccion.diaQueSeAcaban).toBe(25);
    expect(r.proyeccion.costo).toBeCloseTo(200 * TARIFAS_MX.service, 2);
    expect(resumirMes(filas(150), base).proyeccion.diaQueSeAcaban).toBeNull();
  });

  it("si el reporte de Meta cuenta más que el CRM, manda Meta", () => {
    const r = resumirMes(filas(18), { ...base, minimos: { respuestas: 81, plantillas: 3 } });
    expect(r.servicio.usadas).toBe(81);
    expect(r.plantillas.utility).toBe(3);
    expect(r.fueraDelCrm).toEqual({ respuestas: 63, plantillas: 3 });
    const igual = resumirMes(filas(100), { ...base, minimos: { respuestas: 40, plantillas: 0 } });
    expect(igual.servicio.usadas).toBe(100);
    expect(igual.fueraDelCrm).toEqual({ respuestas: 0, plantillas: 0 });
  });

  it("reparte por día y por quién manda", () => {
    const r = resumirMes(
      [
        { dia: 3, origen: "ai", categoria: null, tipo: null },
        { dia: 3, origen: "operator", categoria: null, tipo: null },
        { dia: 4, origen: "template", categoria: "utility", tipo: "regular" },
      ],
      base
    );
    expect(r.porDia[2]).toEqual({ dia: 3, nea: 1, personas: 1, plantillas: 0 });
    expect(r.porDia[3]).toEqual({ dia: 4, nea: 0, personas: 0, plantillas: 1 });
    expect(r.porDia).toHaveLength(30);
  });
});

describe("sumarReporteMeta", () => {
  it("suma el reporte de costos de Meta (formato real)", () => {
    const s = sumarReporteMeta([
      { pricing_type: "FREE_CUSTOMER_SERVICE", pricing_category: "SERVICE", volume: 8, cost: 0 },
      { pricing_type: "REGULAR", pricing_category: "UTILITY", volume: 1, cost: 0.1565 },
      { pricing_type: "REGULAR", pricing_category: "SERVICE", volume: 2, cost: 0.313 },
    ]);
    expect(s).toEqual({ costo: 0.47, respuestas: 10, plantillas: 1 });
  });
});

describe("avisos al dueño", () => {
  it("avisa una vez por nivel y por mes, y al subir de nivel", () => {
    expect(hayQueAvisar("bien", "2026-10", null)).toBe(false);
    expect(hayQueAvisar("cerca", "2026-10", null)).toBe(true);
    expect(hayQueAvisar("cerca", "2026-10", claveAviso("2026-10", "cerca"))).toBe(false);
    expect(hayQueAvisar("cobra", "2026-10", claveAviso("2026-10", "cerca"))).toBe(true);
    expect(hayQueAvisar("cerca", "2026-10", claveAviso("2026-10", "cobra"))).toBe(false);
    expect(hayQueAvisar("cerca", "2026-11", claveAviso("2026-10", "no_entrega"))).toBe(true);
  });
  it("el texto dice lo que pasa, sin variables sueltas", () => {
    const r = resumirMes(filas(850), base);
    const t = textoAviso(r, 80);
    expect(t).toContain("850");
    expect(t).toContain(String(GRATIS_SERVICIO.toLocaleString("es-MX")));
    expect(textoAviso(resumirMes(filas(10), base), 80)).toBeNull();
    expect(textoAviso(resumirMes(filas(10), { ...base, fallosPago: 2 }), 80)).toMatch(/problema de pago/);
  });
});

describe("configSchema", () => {
  it("limpia el teléfono y valida", () => {
    const r = configSchema.parse({ ...CONFIG_POR_DEFECTO, telefonoDueno: "+52 81 1234 5678" });
    expect(r.telefonoDueno).toBe("528112345678");
    expect(configSchema.safeParse({ ...CONFIG_POR_DEFECTO, telefonoDueno: "123" }).success).toBe(false);
    expect(configSchema.safeParse({ ...CONFIG_POR_DEFECTO, alertaPct: 30 }).success).toBe(false);
    expect(configSchema.safeParse(CONFIG_POR_DEFECTO).success).toBe(true);
  });
});

describe("mesEnZona", () => {
  it("el mes del negocio, no el de UTC", () => {
    // 1 de noviembre 02:00 UTC = 31 de octubre 20:00 en Monterrey/CDMX.
    const m = mesEnZona(new Date("2026-11-01T02:00:00Z"), "America/Mexico_City");
    expect(m.mes).toBe("2026-10");
    expect(m.dia).toBe(31);
    expect(m.diasMes).toBe(31);
    expect(m.inicio.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(m.fin.toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });
  it("diciembre pasa al año siguiente", () => {
    const m = mesEnZona(new Date("2026-12-15T12:00:00Z"), "America/Mexico_City");
    expect(m.fin.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });
});
