import { describe, expect, it } from "vitest";
import { settingsInicio, settingsSections } from "@/lib/nav";
import { esEtapaDeAceptada, esEtapaDeCotizacion, etapaDeAceptada, etapaDeCotizacion, productoSchema } from "@/lib/cotizaciones";
import { etapaDeAnticipo } from "@/lib/pedidos";
import { esEtapaDeVisita } from "@/lib/agenda-etapa";
import { LOSS_REASONS, LOSS_REASONS_A_ELEGIR, LOSS_REASON_LABEL } from "@/lib/types";

/**
 * Módulo de la agencia — Ajustes con una sección «Ventas» que abre primero,
 * productos «extra o servicio» y la etapa «Cotización enviada» que pone el CRM.
 */

describe("Ajustes → Ventas", () => {
  const links = (s: ReturnType<typeof settingsSections>) =>
    Object.fromEntries(s.map((x) => [x.title, x.links.map((l) => l.label)]));

  it("con los módulos de venta: Ventas primero y Canales al final", () => {
    const s = settingsSections({ cotizaciones: true, pedidos: true, seguimiento: true, biblioteca: true, agenda: true });
    expect(s.map((x) => x.title)).toEqual(["Ventas", "Agente", "Negocio", "Canales"]);
    expect(links(s).Ventas).toEqual(["Cotizaciones", "Vendedor", "Fletes", "Pedidos", "Seguimiento", "Biblioteca", "Reporte semanal"]);
    expect(links(s).Agente).toEqual(["IA", "Agenda"]);
    expect(links(s).Negocio).not.toContain("Cotizaciones");
    expect(links(s).Negocio).not.toContain("Pedidos");
  });

  it("sin módulos de venta, igual que siempre", () => {
    expect(settingsSections({}).map((x) => x.title)).toEqual(["Canales", "Agente", "Negocio"]);
  });

  it("«Ajustes» abre en la primera pantalla: Cotizaciones, o WhatsApp sin módulos", () => {
    expect(settingsInicio(settingsSections({ cotizaciones: true, pedidos: true }))).toBe("/settings/cotizaciones");
    expect(settingsInicio(settingsSections({ pedidos: true }))).toBe("/settings/pedidos");
    expect(settingsInicio(settingsSections({}))).toBe("/settings/whatsapp");
    expect(settingsInicio([])).toBe("/settings/whatsapp");
  });
});

describe("productos extra o servicio", () => {
  it("un producto es modelo por defecto; el flete se marca extra", () => {
    expect(productoSchema.parse({ id: "p1", nombre: "Domo Mini", precio: 1 }).extra).toBe(false);
    expect(productoSchema.parse({ id: "p2", nombre: "Flete desde Apodaca", precio: 1, extra: true }).extra).toBe(true);
  });
});

describe("la etapa de cotización enviada", () => {
  it("reconoce «Cotización enviada» y no «Pidió cotización»", () => {
    expect(esEtapaDeCotizacion("Cotización enviada")).toBe(true);
    expect(esEtapaDeCotizacion("COTIZADO")).toBe(true);
    expect(esEtapaDeCotizacion("Pidió cotización")).toBe(false);
    expect(esEtapaDeCotizacion("Solicita cotización")).toBe(false);
    expect(esEtapaDeCotizacion("Negociación")).toBe(false);
  });

  it("solo una etapa abierta", () => {
    const etapas = [
      { name: "Nuevo", kind: "open" },
      { name: "Calificado", kind: "open" },
      { name: "Cotización enviada", kind: "open" },
      { name: "Anticipo pagado", kind: "won" },
    ];
    expect(etapaDeCotizacion(etapas)?.name).toBe("Cotización enviada");
    expect(etapaDeCotizacion([{ name: "Cotización enviada", kind: "won" }])).toBeNull();
    expect(etapaDeCotizacion([{ name: "Nuevo", kind: "open" }])).toBeNull();
  });
});

describe("Módulo de la agencia — etapa de cotización aceptada", () => {
  const etapas = [
    { name: "Nuevo", kind: "open" },
    { name: "Calificado", kind: "open" },
    { name: "Cita por videollamada", kind: "open" },
    { name: "Cotización enviada", kind: "open" },
    { name: "Cotización aceptada", kind: "open" },
    { name: "Anticipo pagado", kind: "won" },
    { name: "Perdido", kind: "lost" },
  ];

  it("reconoce la etapa de aceptada y no la confunde con la de enviada", () => {
    expect(esEtapaDeAceptada("Cotización aceptada")).toBe(true);
    expect(esEtapaDeAceptada("ACEPTÓ")).toBe(true);
    expect(esEtapaDeAceptada("Anticipo aceptado")).toBe(false);
    expect(esEtapaDeAceptada("Cotización enviada")).toBe(false);
    expect(etapaDeAceptada(etapas)?.name).toBe("Cotización aceptada");
    expect(etapaDeCotizacion(etapas)?.name).toBe("Cotización enviada");
    // Aunque estuvieran al revés, «enviada» nunca es la de aceptada.
    expect(etapaDeCotizacion([...etapas].reverse())?.name).toBe("Cotización enviada");
    expect(etapaDeAceptada([{ name: "Nuevo", kind: "open" }])).toBeNull();
  });

  it("el pago y la agenda siguen eligiendo su etapa", () => {
    expect(etapaDeAnticipo(etapas)?.name).toBe("Anticipo pagado");
    expect(esEtapaDeVisita("Cita por videollamada")).toBe(true);
  });

  it("los motivos de pérdida que se ofrecen tienen etiqueta y son válidos", () => {
    for (const r of LOSS_REASONS_A_ELEGIR) {
      expect(LOSS_REASONS).toContain(r);
      expect(LOSS_REASON_LABEL[r]).toBeTruthy();
    }
    expect(LOSS_REASONS_A_ELEGIR).toContain("flete_caro");
  });
});
