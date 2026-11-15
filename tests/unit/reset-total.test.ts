import { afterEach, describe, expect, it } from "vitest";
import { TABLAS_DE_LA_CONVERSACION, resetTotalEnabled } from "@/server/reset-total";

describe("reset total (módulo de la agencia)", () => {
  const antes = process.env.RESET_TOTAL;
  afterEach(() => {
    if (antes === undefined) delete process.env.RESET_TOTAL;
    else process.env.RESET_TOTAL = antes;
  });

  it("está apagado por defecto", () => {
    delete process.env.RESET_TOTAL;
    expect(resetTotalEnabled()).toBe(false);
    process.env.RESET_TOTAL = "on";
    expect(resetTotalEnabled()).toBe(true);
  });

  it("borra lo que el agente podía «recordar» de la prueba anterior", () => {
    for (const t of ["agencia_cotizacion", "agencia_pedido", "agencia_termometro", "agencia_resumen_traspaso"]) {
      expect(TABLAS_DE_LA_CONVERSACION).toContain(t);
    }
  });

  it("borra los pedidos antes que las cotizaciones a las que apuntan", () => {
    const orden = [...TABLAS_DE_LA_CONVERSACION];
    expect(orden.indexOf("agencia_pedido")).toBeLessThan(orden.indexOf("agencia_cotizacion"));
    expect(orden.indexOf("agencia_aprende_sugerencia")).toBeLessThan(orden.indexOf("agencia_aprende_traspaso"));
  });
});
