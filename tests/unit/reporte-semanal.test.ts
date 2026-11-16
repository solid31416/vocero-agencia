import { describe, expect, it } from "vitest";
import {
  configSchema,
  periodoLegible,
  textoDelReporte,
  tocaReporte,
  variablesDelReporte,
  type ReporteDto,
} from "@/lib/reporte-semanal";

const reporte: ReporteDto = {
  desde: "2026-11-09",
  hasta: "2026-11-15",
  negocio: "Wis Dome House",
  moneda: "MXN",
  nuevos: 12,
  modelos: [
    { nombre: "Domo Mini", interesados: 7 },
    { nombre: "Domo Estándar", interesados: 4 },
  ],
  cotizaciones: { n: 5, monto: 420000 },
  cerradas: { n: 2, monto: 180000 },
  cobrado: 90000,
  porCobrar: { monto: 90000, tocan: 1 },
  sinRespuesta: 3,
  url: "https://crm.ejemplo.com",
};

describe("reporte semanal", () => {
  it("periodo legible", () => {
    expect(periodoLegible("2026-11-09", "2026-11-15")).toBe("9 al 15 nov");
    expect(periodoLegible("2026-10-28", "2026-11-03")).toBe("28 oct al 3 nov");
  });

  it("el texto trae todo", () => {
    const t = textoDelReporte(reporte);
    expect(t).toContain("Wis Dome House (9 al 15 nov)");
    expect(t).toContain("Clientes nuevos: 12");
    expect(t).toContain("Domo Mini (7), Domo Estándar (4)");
    expect(t).toContain("Cotizaciones enviadas: 5 por $420,000");
    expect(t).toContain("Cerradas: 2 por $180,000");
    expect(t).toContain("Por cobrar: $90,000 (1 ya toca)");
    expect(t).toContain("sin respuesta: 3");
    expect(t).toContain("https://crm.ejemplo.com/results");
  });

  it("sin módulos de cotizaciones ni pedidos, solo lo que hay", () => {
    const t = textoDelReporte({ ...reporte, cotizaciones: null, cerradas: null, cobrado: null, porCobrar: null, sinRespuesta: null, modelos: [] });
    expect(t).not.toContain("Cotizaciones");
    expect(t).not.toContain("Cobrado");
  });

  it("variables de la plantilla sin saltos de línea", () => {
    const v = variablesDelReporte(reporte, 6);
    expect(v).toEqual(["9 al 15 nov", "12", "5 ($420,000)", "2 ($180,000)", "$90,000", "$90,000"]);
    expect(variablesDelReporte(reporte, 1)[0]).not.toContain("\n");
    expect(variablesDelReporte(reporte, 3)).toHaveLength(3);
  });

  it("sale el día y la hora elegidos, una vez", () => {
    const config = { activo: true, dia: 1, hora: 9 };
    expect(tocaReporte({ config, hoy: "2026-11-16", diaSemana: 1, horaLocal: 9, ultimoPara: null })).toBe(true);
    expect(tocaReporte({ config, hoy: "2026-11-16", diaSemana: 1, horaLocal: 8, ultimoPara: null })).toBe(false);
    expect(tocaReporte({ config, hoy: "2026-11-17", diaSemana: 2, horaLocal: 9, ultimoPara: null })).toBe(false);
    expect(tocaReporte({ config, hoy: "2026-11-16", diaSemana: 1, horaLocal: 11, ultimoPara: "2026-11-16" })).toBe(false);
    expect(tocaReporte({ config: { ...config, activo: false }, hoy: "2026-11-16", diaSemana: 1, horaLocal: 9, ultimoPara: null })).toBe(false);
  });

  it("el teléfono se limpia", () => {
    expect(configSchema.parse({ telefonoDueno: "+52 81 1784 7322" }).telefonoDueno).toBe("528117847322");
    expect(configSchema.parse({}).dia).toBe(1);
  });
});
