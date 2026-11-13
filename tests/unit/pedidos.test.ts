import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  ETAPAS_POR_DEFECTO,
  armarMensaje,
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
