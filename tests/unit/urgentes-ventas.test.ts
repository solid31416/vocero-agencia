import { beforeEach, describe, expect, it, vi } from "vitest";
import { prometeTraspaso } from "@/lib/promesa-traspaso";
import { etapaAlAgendar } from "@/lib/agenda-etapa";
import { esEtapaDeCotizacion } from "@/lib/cotizaciones";
import { PLANTILLAS_VENTAS, plantillasVentasPara, variablesDe } from "@/lib/plantillas-ventas";

/**
 * Módulo de la agencia — los tres urgentes de la revisión: la red de
 * seguridad del traspaso, la etapa al agendar y las plantillas de ventas.
 */

const dbState = vi.hoisted(() => ({ queue: [] as unknown[][], updates: 0 }));
const avisos = vi.hoisted(() => ({ resumen: [] as unknown[], aprende: [] as unknown[], eventos: [] as unknown[] }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy", "set", "returning"]) builder[m] = () => builder;
  builder.update = () => {
    dbState.updates += 1;
    return builder;
  };
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(dbState.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});
vi.mock("@/server/resumen-traspaso/generar", () => ({
  dispararResumen: (...a: unknown[]) => avisos.resumen.push(a),
}));
vi.mock("@/server/aprende-traspasos/analizar", () => ({
  registrarTraspaso: (...a: unknown[]) => avisos.aprende.push(a),
}));
vi.mock("@/server/events/bus", () => ({ publish: (...a: unknown[]) => avisos.eventos.push(a) }));

const { cumplirPromesa } = await import("@/server/bot/promesa-traspaso");

describe("¿el agente prometió una persona?", () => {
  it.each([
    "Ese dato no lo manejo por aquí, Saúl, así que te paso con una persona del equipo que te lo confirma de inmediato 😊",
    "¡Gracias, Saúl! Ya pasé tu proyecto al asesor: 3 domos Mini para glamping.",
    "Va. Un asesor te contacta en un momento.",
    "Te comunico con nuestro equipo de ventas.",
    "Una persona del equipo te confirma el dato hoy mismo.",
  ])("sí: «%s»", (texto) => {
    expect(prometeTraspaso(texto)).toBe(true);
  });

  it.each([
    "¿Quieres que te pase con un asesor?",
    "¿Te paso con una persona del equipo?",
    "Si prefieres, te paso con alguien del equipo.",
    "Te paso con gusto la ficha técnica del Mini.",
    "El Domo Mini cuesta $125,000 más IVA.",
    "Nuestro equipo fabrica cada domo en Apodaca.",
  ])("no: «%s»", (texto) => {
    expect(prometeTraspaso(texto)).toBe(false);
  });
});

describe("el CRM cumple la promesa de traspaso", () => {
  beforeEach(() => {
    dbState.queue = [];
    dbState.updates = 0;
    avisos.resumen = [];
    avisos.aprende = [];
    avisos.eventos = [];
  });

  it("si nadie hizo el traspaso: pausa la IA, avisa al dueño y lo cuenta", async () => {
    dbState.queue.push([{ aiEnabled: true, handoffAt: null, isTest: false }], [{ id: "cv_1" }]);
    expect(await cumplirPromesa("org_1", "cv_1")).toBe(true);
    expect(dbState.updates).toBe(1);
    expect(avisos.resumen).toEqual([["org_1", "cv_1", "modelo", { avisar: true }]]);
    expect(avisos.aprende).toHaveLength(1);
    expect(avisos.eventos).toHaveLength(1);
  });

  it.each([
    ["el agente sí pidió el traspaso", { aiEnabled: false, handoffAt: new Date(), isTest: false }],
    ["una persona apagó la IA", { aiEnabled: false, handoffAt: null, isTest: false }],
    ["es del Laboratorio", { aiEnabled: true, handoffAt: null, isTest: true }],
  ])("no toca nada si %s", async (_c, conv) => {
    dbState.queue.push([conv]);
    expect(await cumplirPromesa("org_1", "cv_1")).toBe(false);
    expect(dbState.updates).toBe(0);
    expect(avisos.resumen).toEqual([]);
  });
});

describe("la etapa al agendar", () => {
  const WIS = [
    { id: "nuevo", name: "Nuevo", kind: "open", position: 0 },
    { id: "calif", name: "Calificado", kind: "open", position: 1 },
    { id: "cot", name: "Cotización enviada", kind: "open", position: 2 },
    { id: "visita", name: "Visita o demo", kind: "open", position: 3 },
    { id: "nego", name: "Negociación", kind: "open", position: 4 },
    { id: "anticipo", name: "Anticipo pagado", kind: "won", position: 5 },
    { id: "perdido", name: "Perdido", kind: "lost", position: 6 },
  ];
  const saltar = (n: string) => esEtapaDeCotizacion(n);

  it("desde Calificado va a «Visita o demo», no a «Cotización enviada»", () => {
    expect(etapaAlAgendar(WIS, "calif", { saltar })?.id).toBe("visita");
    expect(etapaAlAgendar(WIS, "nuevo", { saltar })?.id).toBe("visita");
    expect(etapaAlAgendar(WIS, "cot", { saltar })?.id).toBe("visita");
  });

  it("si ya está en la visita o más adelante, no se mueve", () => {
    expect(etapaAlAgendar(WIS, "visita", { saltar })).toBeNull();
    expect(etapaAlAgendar(WIS, "nego", { saltar })).toBeNull();
    expect(etapaAlAgendar(WIS, "anticipo", { saltar })).toBeNull();
  });

  it("sin etapa de visita: la siguiente abierta, saltando la de cotización", () => {
    const sin = WIS.filter((s) => s.id !== "visita");
    expect(etapaAlAgendar(sin, "calif", { saltar })?.id).toBe("nego");
    expect(etapaAlAgendar(sin, "calif")?.id).toBe("cot");
    expect(etapaAlAgendar(sin, "nuevo", { saltar })?.id).toBe("calif");
  });

  it("un embudo con «Cita agendada» sigue igual que siempre", () => {
    const base = [
      { id: "n", name: "Nuevo", kind: "open", position: 0 },
      { id: "c", name: "Calificado", kind: "open", position: 1 },
      { id: "a", name: "Cita agendada", kind: "open", position: 2 },
      { id: "g", name: "Ganado", kind: "won", position: 3 },
    ];
    expect(etapaAlAgendar(base, "n")?.id).toBe("a");
    expect(etapaAlAgendar(base, "a")).toBeNull();
    expect(etapaAlAgendar(base, "x")).toBeNull();
  });
});

describe("las plantillas de ventas", () => {
  it("un ejemplo por variable y nombres válidos para Meta, sin repetir", () => {
    for (const p of PLANTILLAS_VENTAS) {
      expect(p.examples).toHaveLength(variablesDe(p.body));
      expect(p.name).toMatch(/^[a-z0-9_]+$/);
      expect(p.body.length).toBeLessThanOrEqual(1024);
    }
    expect(new Set(PLANTILLAS_VENTAS.map((p) => p.name)).size).toBe(PLANTILLAS_VENTAS.length);
  });

  it("respetan los topes de cada pantalla (saldo hasta 3 variables, reporte 6)", () => {
    const de = (n: string) => PLANTILLAS_VENTAS.find((p) => p.name === n)!;
    expect(variablesDe(de("ventas_saldo_pendiente").body)).toBeLessThanOrEqual(3);
    expect(variablesDe(de("ventas_reporte_semanal").body)).toBe(6);
  });

  it("solo las de los módulos encendidos", () => {
    expect(plantillasVentasPara({ cotizaciones: false, pedidos: false, agenda: false })).toEqual([]);
    expect(plantillasVentasPara({ cotizaciones: false, pedidos: true, agenda: false }).map((p) => p.name)).toEqual([
      "ventas_avance_pedido",
      "ventas_saldo_pendiente",
    ]);
    expect(plantillasVentasPara({ cotizaciones: true, pedidos: true, agenda: true })).toHaveLength(5);
  });
});
