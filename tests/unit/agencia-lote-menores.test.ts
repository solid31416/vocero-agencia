import { describe, expect, it } from "vitest";
import { formatoDinero } from "@/lib/cotizaciones";
import { fechaLegible, pagoInputSchema, resumenParaFicha } from "@/lib/pedidos";
import {
  datosDeVenta,
  normalizarAtajo,
  RESPUESTAS_DE_ARRANQUE,
  rellenarVariables,
  usaVariablesDeVenta,
  ATAJO_RE,
} from "@/lib/respuestas-rapidas";

/** Módulo de la agencia — respuestas con datos de venta, fecha del saldo al pagar y en la ficha. */

const formato = { dinero: (n: number) => formatoDinero(n), fecha: (iso: string) => fechaLegible(iso) };

describe("respuestas rápidas con datos de la venta", () => {
  const cot = {
    folio: "COT-0009",
    estado: "enviada",
    partidas: [
      { concepto: "Flete", cantidad: 1, precio: 12000 },
      { concepto: "Domo Modelo Mini", cantidad: 3, precio: 125000 },
    ],
    totales: { total: 448920, anticipo: 224460 },
  };
  const ped = { folio: "PED-0002", saldo: 224460, cobrarSaldoEl: "2027-01-15", creadoEn: "2026-11-16T10:00:00Z" };

  it("llena folio, total, anticipo, producto, pedido, saldo y fecha", () => {
    const d = datosDeVenta([{ ...cot, folio: "COT-0010", estado: "borrador" }, cot], [ped], formato);
    expect(d).toMatchObject({
      folio: "COT-0009",
      total: formatoDinero(448920),
      anticipo: formatoDinero(224460),
      producto: "Domo Modelo Mini",
      pedido: "PED-0002",
      saldo: formatoDinero(224460),
    });
    expect(d.fecha_saldo).toBe(fechaLegible("2027-01-15"));
    expect(rellenarVariables("Hola {nombre}, tu {folio} queda en {anticipo}.", "Saúl Garza", d)).toBe(
      `Hola Saúl, tu COT-0009 queda en ${formatoDinero(224460)}.`
    );
  });

  it("lo que no se sabe se queda escrito para llenarlo a mano", () => {
    expect(rellenarVariables("Saldo: {saldo} · {otra}", "Ana", {})).toBe("Saldo: {saldo} · {otra}");
    expect(datosDeVenta([], [], formato)).toEqual({});
  });

  it("solo pide datos si la respuesta usa variables de venta", () => {
    expect(usaVariablesDeVenta("Hola {nombre}")).toBe(false);
    expect(usaVariablesDeVenta("Tu saldo es { Saldo }")).toBe(true);
  });

  it("los ejemplos de arranque tienen atajos válidos y sin repetir", () => {
    const atajos = RESPUESTAS_DE_ARRANQUE.map((r) => r.atajo);
    expect(new Set(atajos).size).toBe(atajos.length);
    for (const a of atajos) expect(ATAJO_RE.test(normalizarAtajo(a))).toBe(true);
    expect(RESPUESTAS_DE_ARRANQUE.every((r) => r.texto.length < 4096)).toBe(true);
  });
});

describe("fecha del saldo", () => {
  it("se puede mandar al registrar el pago (o no)", () => {
    expect(pagoInputSchema.parse({ monto: 224460, cobrarSaldoEl: "2027-01-15" }).cobrarSaldoEl).toBe("2027-01-15");
    expect(pagoInputSchema.parse({ monto: 224460 }).cobrarSaldoEl).toBeUndefined();
    expect(pagoInputSchema.safeParse({ monto: 1, cobrarSaldoEl: "15/01/2027" }).success).toBe(false);
  });

  it("la ficha dice cuándo se paga el saldo (lo que lee el agente)", () => {
    const base = { folio: "PED-0002", concepto: "Domo", etapaNombre: "Fabricación", fechaEstimada: null, esUltima: false };
    expect(
      resumenParaFicha({ ...base, pagos: { pagado: "$224,460.00", saldo: "$224,460.00", liquidado: false, cobrarSaldoEl: "2027-01-15" } })
    ).toContain(`el saldo se paga el ${fechaLegible("2027-01-15")}`);
    expect(
      resumenParaFicha({ ...base, pagos: { pagado: "$1", saldo: null, liquidado: true, cobrarSaldoEl: "2027-01-15" } })
    ).not.toContain("saldo se paga");
  });
});
