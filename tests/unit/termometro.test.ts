import { describe, expect, it } from "vitest";
import {
  CALMA_MS,
  CONFIG_POR_DEFECTO,
  ETIQUETAS_POR_DEFECTO,
  MAX_ETIQUETAS,
  VENTANA_MS,
  armarPrompt,
  configSchema,
  debeClasificar,
  idDeEtiqueta,
  limpiarClasificacion,
  manualSchema,
  textoDeMensaje,
} from "@/lib/termometro";

describe("configSchema", () => {
  it("por defecto: encendido y con etiquetas de inicio", () => {
    const c = configSchema.parse({});
    expect(c).toEqual(CONFIG_POR_DEFECTO);
    expect(c.activo).toBe(true);
    expect(c.etiquetas.length).toBe(ETIQUETAS_POR_DEFECTO.length);
  });

  it("el id sale del nombre, sin acentos; repetidas se quedan en una; color raro → gris", () => {
    const c = configSchema.parse({
      etiquetas: [
        { nombre: "Cotización Mayoreo", color: "verde" },
        { nombre: "cotizacion  mayoreo", color: "rojo" },
        { nombre: "Urgente", color: "fosforescente" },
      ],
    });
    expect(c.etiquetas).toEqual([
      { id: "cotizacion-mayoreo", nombre: "Cotización Mayoreo", descripcion: "", color: "verde" },
      { id: "urgente", nombre: "Urgente", descripcion: "", color: "gris" },
    ]);
  });

  it("rechaza nombres vacíos y demasiadas etiquetas; deja la lista vacía", () => {
    expect(configSchema.safeParse({ etiquetas: [{ nombre: "  " }] }).success).toBe(false);
    const muchas = Array.from({ length: MAX_ETIQUETAS + 1 }, (_, i) => ({ nombre: `e${i}` }));
    expect(configSchema.safeParse({ etiquetas: muchas }).success).toBe(false);
    expect(configSchema.parse({ etiquetas: [] }).etiquetas).toEqual([]);
  });

  it("idDeEtiqueta", () => {
    expect(idDeEtiqueta("  ¿Ya es cliente? ")).toBe("ya-es-cliente");
  });
});

describe("limpiarClasificacion", () => {
  const etiquetas = ETIQUETAS_POR_DEFECTO;

  it("acepta id o nombre, quita las que no existen y repetidas, máximo 3", () => {
    const r = limpiarClasificacion(
      {
        temperatura: "Caliente",
        etiquetas: ["cotizacion", "Quiere cita", "inventada", "cotizacion", "Queja", "ya-es-cliente"],
        razon: "Pidió precio y quiere agendar",
      },
      etiquetas
    );
    expect(r).toEqual({
      temperatura: "caliente",
      etiquetas: ["cotizacion", "quiere-cita", "queja"],
      razon: "Pidió precio y quiere agendar",
    });
  });

  it("entiende variantes de temperatura y tolera basura", () => {
    expect(limpiarClasificacion({ temperatura: "fría" }, etiquetas).temperatura).toBe("fria");
    expect(limpiarClasificacion({ temperatura: "tibio" }, etiquetas).temperatura).toBe("tibia");
    expect(limpiarClasificacion({ temperatura: "hirviendo", etiquetas: "x" }, etiquetas)).toEqual({
      temperatura: null,
      etiquetas: [],
      razon: "",
    });
    expect(limpiarClasificacion("nada", etiquetas)).toEqual({ temperatura: null, etiquetas: [], razon: "" });
  });
});

describe("debeClasificar", () => {
  const ahora = new Date("2026-11-01T12:00:00Z");
  const hace = (ms: number) => new Date(ahora.getTime() - ms);

  it("espera la calma, salvo con «Clasificar ahora»", () => {
    const base = { ultimoMensajeEn: hace(CALMA_MS - 1000), clasificadoEn: null, manual: false, ahora };
    expect(debeClasificar(base)).toBe(false);
    expect(debeClasificar({ ...base, forzar: true })).toBe(true);
    expect(debeClasificar({ ...base, ultimoMensajeEn: hace(CALMA_MS) })).toBe(true);
  });

  it("solo si hubo mensajes desde la última vez", () => {
    const ultimo = hace(10 * 60 * 1000);
    expect(debeClasificar({ ultimoMensajeEn: ultimo, clasificadoEn: hace(5 * 60 * 1000), manual: false, ahora })).toBe(false);
    expect(debeClasificar({ ultimoMensajeEn: ultimo, clasificadoEn: hace(20 * 60 * 1000), manual: false, ahora })).toBe(true);
  });

  it("nunca las corregidas a mano, ni las viejas, ni sin mensajes", () => {
    expect(debeClasificar({ ultimoMensajeEn: hace(CALMA_MS * 2), clasificadoEn: null, manual: true, ahora })).toBe(false);
    expect(debeClasificar({ ultimoMensajeEn: hace(VENTANA_MS + 1), clasificadoEn: null, manual: false, ahora })).toBe(false);
    expect(debeClasificar({ ultimoMensajeEn: null, clasificadoEn: null, manual: false, ahora })).toBe(false);
  });
});

describe("armarPrompt", () => {
  it("lleva temperaturas, criterio del dueño, etiquetas con su descripción y la plática", () => {
    const { system, user } = armarPrompt({
      nombreNegocio: "Tacos Ana",
      config: { activo: true, criterio: "pide para más de 20 personas", etiquetas: ETIQUETAS_POR_DEFECTO },
      mensajes: [
        { quien: "cliente", texto: "¿Precio para 30 personas?" },
        { quien: "negocio", texto: "Son $3,000" },
      ],
    });
    expect(system).toContain("Tacos Ana");
    expect(system).toContain('"caliente"');
    expect(system).toContain("pide para más de 20 personas");
    expect(system).toContain('"cotizacion" (Cotización): Pidió precio');
    expect(user.indexOf("CLIENTE: ¿Precio")).toBeLessThan(user.indexOf("NEGOCIO: Son"));
  });

  it("sin etiquetas lo dice", () => {
    const { system } = armarPrompt({ nombreNegocio: "", config: { activo: true, criterio: "", etiquetas: [] }, mensajes: [] });
    expect(system).toContain("no hay etiquetas");
  });
});

describe("varios", () => {
  it("manualSchema: temperatura o nada, máximo 3 etiquetas", () => {
    expect(manualSchema.safeParse({ temperatura: null, etiquetas: [] }).success).toBe(true);
    expect(manualSchema.safeParse({ temperatura: "tibia", etiquetas: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(manualSchema.safeParse({ temperatura: "templada", etiquetas: [] }).success).toBe(false);
  });

  it("textoDeMensaje", () => {
    expect(textoDeMensaje("text", " hola\n\n ")).toBe("hola");
    expect(textoDeMensaje("audio", null)).toBe("[nota de voz]");
  });
});
