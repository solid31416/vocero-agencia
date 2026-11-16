import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  ETAPAS_POR_DEFECTO,
  armarMensaje,
  etapaDeAnticipo,
  mensajeDePago,
  pagoInputSchema,
  resumenPagos,
  tipoDePago,
  tocaCobrar,
  tocaRecordarSaldo,
  textoDeSaldo,
  cambioSchema,
  claveDeEtapa,
  configSchema,
  fechaLegible,
  folioDe,
  indiceDeEtapa,
  pedidoInputSchema,
  resumenParaFicha,
  variablesPlantilla,
} from "@/lib/pedidos";
import { appNavGroups, settingsSections } from "@/lib/nav";
import { pedidosEnabled } from "@/server/pedidos/flag";

describe("pedidos — configuración", () => {
  it("por defecto: confirmado → fabricación → en camino → aduana → entregado → instalado", () => {
    expect(CONFIG_POR_DEFECTO.etapas.map((e) => e.nombre)).toEqual([
      "Pedido confirmado",
      "En fabricación",
      "En camino",
      "En aduana",
      "Entregado",
      "Instalado",
    ]);
    expect(CONFIG_POR_DEFECTO.actualizarFicha).toBe(true);
    expect(CONFIG_POR_DEFECTO.plantillaId).toBeNull();
  });

  it("pide al menos 2 etapas, como mucho 12, y sin claves repetidas", () => {
    const una = [{ id: "a", nombre: "A", mensaje: "" }];
    expect(configSchema.safeParse({ etapas: una }).success).toBe(false);
    const repetidas = [
      { id: "a", nombre: "A", mensaje: "" },
      { id: "a", nombre: "B", mensaje: "" },
    ];
    expect(configSchema.safeParse({ etapas: repetidas }).success).toBe(false);
    const trece = Array.from({ length: 13 }, (_, i) => ({ id: `e${i}`, nombre: `E${i}`, mensaje: "" }));
    expect(configSchema.safeParse({ etapas: trece }).success).toBe(false);
  });

  it("clave estable a partir del nombre, sin chocar", () => {
    expect(claveDeEtapa("En aduana")).toBe("en-aduana");
    expect(claveDeEtapa("Fabricación ✨")).toBe("fabricacion");
    expect(claveDeEtapa("En aduana", ["en-aduana"])).toBe("en-aduana-2");
    expect(claveDeEtapa("!!!")).toBe("etapa");
  });

  it("índice de la etapa para la barra de avance", () => {
    expect(indiceDeEtapa(ETAPAS_POR_DEFECTO, "aduana")).toBe(3);
    expect(indiceDeEtapa(ETAPAS_POR_DEFECTO, "ya-no-existe")).toBe(-1);
  });
});

describe("pedidos — textos", () => {
  const v = {
    contacto: "Marcos Pérez",
    folio: "PED-0003",
    estado: "En fabricación",
    fechaEstimada: "2026-12-05",
    concepto: "2 × Domo Estándar",
  };

  it("arma el mensaje con nombre, folio y fecha", () => {
    expect(armarMensaje(ETAPAS_POR_DEFECTO[1]!.mensaje, v)).toBe(
      "Marcos, tu pedido PED-0003 ya está en fabricación. Entrega estimada: 5 de diciembre de 2026."
    );
  });

  it("sin nombre ni fecha no deja huecos raros", () => {
    expect(armarMensaje("{nombre}, tu pedido {folio} sale el {fecha}.", { ...v, contacto: "", fechaEstimada: null })).toBe(
      "Tu pedido PED-0003 sale el por confirmar."
    );
  });

  it("la fecha no se mueve de día por la zona horaria", () => {
    expect(fechaLegible("2026-01-01")).toBe("1 de enero de 2026");
    expect(fechaLegible(null)).toBe("");
    expect(fechaLegible("basura")).toBe("");
  });

  it("variables de la plantilla y folio", () => {
    expect(variablesPlantilla("Ana López", "PED-0001", "En camino")).toEqual(["Ana", "PED-0001", "En camino"]);
    expect(variablesPlantilla("+52 81 1234", "PED-0001", "En camino")[0]).toBe("👋");
    expect(folioDe(12)).toBe("PED-0012");
  });

  it("lo que lee el agente en la ficha", () => {
    expect(
      resumenParaFicha({
        folio: "PED-0003",
        concepto: "2 × Domo Estándar",
        etapaNombre: "En aduana",
        fechaEstimada: "2026-12-05",
        esUltima: false,
      })
    ).toBe("PED-0003 · 2 × Domo Estándar · estado: En aduana · entrega estimada: 5 de diciembre de 2026");
    expect(
      resumenParaFicha({ folio: "PED-0003", concepto: "X", etapaNombre: "Instalado", fechaEstimada: "2026-12-05", esUltima: true })
    ).toBe("PED-0003 · X · estado: Instalado");
  });
});

describe("pedidos — entradas", () => {
  it("un pedido necesita conversación y concepto; la fecha va AAAA-MM-DD", () => {
    expect(pedidoInputSchema.safeParse({ conversationId: "cv_1", concepto: "" }).success).toBe(false);
    expect(pedidoInputSchema.safeParse({ conversationId: "cv_1", concepto: "Domo", fechaEstimada: "5/12/2026" }).success).toBe(
      false
    );
    const ok = pedidoInputSchema.parse({ conversationId: "cv_1", concepto: "Domo" });
    expect(ok).toMatchObject({ monto: null, fechaEstimada: null, avisar: true, cotizacionId: null });
  });

  it("un cambio puede ser solo de fecha, o de etapa con aviso", () => {
    expect(cambioSchema.parse({ fechaEstimada: "2026-12-01" })).toMatchObject({ avisar: true, nota: "" });
    expect(cambioSchema.safeParse({ etapaId: "aduana", avisar: false }).success).toBe(true);
    expect(cambioSchema.safeParse({ monto: -1 }).success).toBe(false);
  });
});

describe("pedidos — menú y bandera", () => {
  const previo = process.env.PEDIDOS;
  afterEach(() => {
    if (previo === undefined) delete process.env.PEDIDOS;
    else process.env.PEDIDOS = previo;
  });

  it("«Pedidos» en el menú y en Ajustes solo con la bandera", () => {
    const menu = (p: boolean) => appNavGroups({ pedidos: p }).flatMap((g) => g.items.map((i) => i.href));
    const ajustes = (p: boolean) => settingsSections({ pedidos: p }).flatMap((s) => s.links.map((l) => l.href));
    expect(menu(false)).not.toContain("/pedidos");
    expect(menu(true)).toContain("/pedidos");
    expect(ajustes(false)).not.toContain("/settings/pedidos");
    expect(ajustes(true)).toContain("/settings/pedidos");
  });

  it("apagada por defecto, encendida con on", () => {
    delete process.env.PEDIDOS;
    expect(pedidosEnabled()).toBe(false);
    process.env.PEDIDOS = "on";
    expect(pedidosEnabled()).toBe(true);
  });
});

describe("anticipo y saldo", () => {
  it("cuánto se pagó y cuánto falta", () => {
    expect(resumenPagos(145000, [])).toEqual({ pagado: 0, saldo: 145000, liquidado: false });
    expect(resumenPagos(145000, [{ monto: 72500 }])).toEqual({ pagado: 72500, saldo: 72500, liquidado: false });
    expect(resumenPagos(145000, [{ monto: 72500 }, { monto: 72500 }])).toEqual({ pagado: 145000, saldo: 0, liquidado: true });
    expect(resumenPagos(100, [{ monto: 150 }])).toMatchObject({ saldo: 0, liquidado: true });
    expect(resumenPagos(null, [{ monto: 10 }])).toEqual({ pagado: 10, saldo: null, liquidado: false });
  });

  it("el primero es el anticipo y el que deja en cero, la liquidación", () => {
    expect(tipoDePago(145000, [], 72500)).toBe("anticipo");
    expect(tipoDePago(145000, [{ monto: 72500 }], 30000)).toBe("abono");
    expect(tipoDePago(145000, [{ monto: 72500 }, { monto: 30000 }], 42500)).toBe("liquidacion");
    expect(tipoDePago(145000, [], 145000)).toBe("liquidacion");
    expect(tipoDePago(null, [], 500)).toBe("anticipo");
  });

  it("toca cobrar solo con saldo y la fecha ya llegó", () => {
    expect(tocaCobrar(1000, "2026-11-16", "2026-11-16")).toBe(true);
    expect(tocaCobrar(1000, "2026-11-20", "2026-11-16")).toBe(false);
    expect(tocaCobrar(0, "2026-11-01", "2026-11-16")).toBe(false);
    expect(tocaCobrar(1000, null, "2026-11-16")).toBe(false);
  });

  it("la etapa del embudo para el anticipo", () => {
    const etapas = [
      { name: "Negociación", kind: "open" },
      { name: "Anticipo pagado", kind: "open" },
      { name: "Ganado", kind: "won" },
    ];
    expect(etapaDeAnticipo(etapas)?.name).toBe("Anticipo pagado");
    expect(etapaDeAnticipo([{ name: "Nuevo", kind: "open" }])).toBeNull();
  });

  it("el aviso al cliente", () => {
    const base = { contacto: "Saúl Garza", folio: "PED-0001", monto: "$72,500.00" };
    expect(mensajeDePago({ ...base, saldo: "$72,500.00", liquidado: false })).toBe(
      "Hola Saúl, recibimos tu pago de $72,500.00 para tu pedido PED-0001. ¡Gracias! Queda un saldo de $72,500.00."
    );
    expect(mensajeDePago({ ...base, saldo: null, liquidado: true })).toContain("quedó liquidado");
  });

  it("un pago necesita monto mayor a cero", () => {
    expect(pagoInputSchema.safeParse({ monto: 0 }).success).toBe(false);
    expect(pagoInputSchema.parse({ monto: 100 })).toMatchObject({ fecha: null, nota: "", avisar: false });
  });

  it("la ficha dice cuánto lleva pagado", () => {
    expect(
      resumenParaFicha({
        folio: "PED-0001",
        concepto: "Domo Mini",
        etapaNombre: "En fabricación",
        fechaEstimada: null,
        esUltima: false,
        pagos: { pagado: "$72,500.00", saldo: "$72,500.00", liquidado: false },
      })
    ).toBe("PED-0001 · Domo Mini · estado: En fabricación · pagado: $72,500.00, falta: $72,500.00");
  });
});

describe("recordar el saldo al cliente", () => {
  const base = { saldo: 45000, cobrarSaldoEl: "2026-11-20", recordadoPara: null, hoy: "2026-11-20", horaLocal: 10, hora: 10 };

  it("sale el día de cobro a partir de la hora elegida", () => {
    expect(tocaRecordarSaldo(base)).toBe(true);
    expect(tocaRecordarSaldo({ ...base, horaLocal: 9 })).toBe(false);
    expect(tocaRecordarSaldo({ ...base, hoy: "2026-11-19" })).toBe(false);
  });

  it("una sola vez por fecha de cobro; si cambia la fecha, vuelve a salir", () => {
    expect(tocaRecordarSaldo({ ...base, recordadoPara: "2026-11-20" })).toBe(false);
    expect(tocaRecordarSaldo({ ...base, recordadoPara: "2026-11-10" })).toBe(true);
  });

  it("atrasado sale a cualquier hora, pero no después de 3 días", () => {
    expect(tocaRecordarSaldo({ ...base, hoy: "2026-11-22", horaLocal: 7 })).toBe(true);
    expect(tocaRecordarSaldo({ ...base, hoy: "2026-11-24" })).toBe(false);
  });

  it("sin saldo, no", () => {
    expect(tocaRecordarSaldo({ ...base, saldo: 0 })).toBe(false);
    expect(tocaRecordarSaldo({ ...base, saldo: null })).toBe(false);
  });

  it("el texto con sus datos", () => {
    expect(
      textoDeSaldo("Hola {nombre}, te falta {saldo} de {folio} ({concepto}).", {
        contacto: "Saúl Garza — Domos Garza",
        saldo: "$45,000.00",
        folio: "PED-0003",
        concepto: "Domo Mini",
      })
    ).toBe("Hola Saúl, te falta $45,000.00 de PED-0003 (Domo Mini).");
  });

  it("la configuración vieja se lee con el recordatorio apagado", () => {
    expect(configSchema.parse({}).recordarSaldo.activo).toBe(false);
  });
});
