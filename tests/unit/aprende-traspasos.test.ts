import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  MAX_SUGERENCIAS,
  SILENCIO_PARA_ANALIZAR_MS,
  VENCE_SIN_RESPUESTA_MS,
  armarPrompt,
  configSchema,
  decidir,
  limpiarSugerencias,
  palabrasClave,
  quienHabla,
  respuestaIaSchema,
  sonParecidas,
  textoDeMensaje,
} from "@/lib/aprende-traspasos";

const H = 60 * 60 * 1000;

describe("decidir", () => {
  const desde = new Date("2026-11-01T00:00:00Z");

  it("espera mientras ninguna persona haya contestado", () => {
    expect(
      decidir({ desde, ahora: new Date(desde.getTime() + 5 * H), iaReactivada: true, personaRespondio: false, ultimoMensajeEn: null })
    ).toBe("esperar");
  });

  it("vence si nadie contestó en 7 días", () => {
    expect(
      decidir({
        desde,
        ahora: new Date(desde.getTime() + VENCE_SIN_RESPUESTA_MS + 1),
        iaReactivada: false,
        personaRespondio: false,
        ultimoMensajeEn: null,
      })
    ).toBe("vencido");
  });

  it("analiza en cuanto la IA se reactiva", () => {
    expect(
      decidir({ desde, ahora: new Date(desde.getTime() + 60_000), iaReactivada: true, personaRespondio: true, ultimoMensajeEn: new Date(desde.getTime() + 30_000) })
    ).toBe("analizar");
  });

  it("con la IA pausada espera a que la plática se calme", () => {
    const ultimo = new Date(desde.getTime() + H);
    const base = { desde, iaReactivada: false, personaRespondio: true, ultimoMensajeEn: ultimo };
    expect(decidir({ ...base, ahora: new Date(ultimo.getTime() + SILENCIO_PARA_ANALIZAR_MS - 1) })).toBe("esperar");
    expect(decidir({ ...base, ahora: new Date(ultimo.getTime() + SILENCIO_PARA_ANALIZAR_MS) })).toBe("analizar");
  });

  it("«Buscar ahora» no espera el silencio, pero sí que alguien haya contestado", () => {
    const ahora = new Date(desde.getTime() + 60_000);
    expect(decidir({ desde, ahora, iaReactivada: false, personaRespondio: true, ultimoMensajeEn: ahora, forzar: true })).toBe("analizar");
    expect(decidir({ desde, ahora, iaReactivada: false, personaRespondio: false, ultimoMensajeEn: ahora, forzar: true })).toBe("esperar");
  });
});

describe("quienHabla", () => {
  it("distingue cliente, agente y persona; las plantillas no cuentan", () => {
    expect(quienHabla({ direction: "in", origin: "operator", aiGenerated: false })).toBe("cliente");
    expect(quienHabla({ direction: "out", origin: "ai", aiGenerated: true })).toBe("agente");
    expect(quienHabla({ direction: "out", origin: "operator", aiGenerated: true })).toBe("agente");
    expect(quienHabla({ direction: "out", origin: "operator", aiGenerated: false })).toBe("persona");
    expect(quienHabla({ direction: "out", origin: "manual", aiGenerated: false })).toBe("persona");
    expect(quienHabla({ direction: "out", origin: "template", aiGenerated: false })).toBeNull();
  });
});

describe("sonParecidas", () => {
  it("ignora acentos, signos y palabras vacías", () => {
    expect(palabrasClave("¿Cuánto cuesta el envío a Monterrey?")).toEqual(["cuesta", "envio", "monterrey"]);
    expect(sonParecidas("¿Cuánto cuesta el envío a Monterrey?", "cuanto cuesta envio monterrey")).toBe(true);
    expect(sonParecidas("¿Hacen envíos a Monterrey?", "¿Aceptan tarjeta de crédito?")).toBe(false);
  });
});

describe("limpiarSugerencias", () => {
  it("quita vacías, repetidas, las que ya están y respeta el máximo", () => {
    const crudas = [
      { pregunta: "¿Aceptan tarjeta?", respuesta: "Sí, Visa y Mastercard.", porque: "No sabía las formas de pago" },
      { pregunta: "¿Aceptan tarjeta de crédito?", respuesta: "Sí.", porque: "" }, // repetida
      { pregunta: "¿Cuál es el horario?", respuesta: "9 a 6.", porque: "" }, // ya está en el conocimiento
      { pregunta: "", respuesta: "algo", porque: "" }, // vacía
      { pregunta: "¿Dan factura?", respuesta: "—", porque: "" }, // sin dato
      "basura",
      { pregunta: "¿Tienen estacionamiento?", respuesta: "Sí, gratis.", porque: "" },
      { pregunta: "¿Hacen envíos foráneos?", respuesta: "Sí, por paquetería.", porque: "" },
      { pregunta: "¿Trabajan domingos?", respuesta: "No.", porque: "" },
    ];
    const r = limpiarSugerencias(crudas, ["¿Cuál es su horario?"]);
    expect(r.map((s) => s.pregunta)).toEqual([
      "¿Aceptan tarjeta?",
      "¿Tienen estacionamiento?",
      "¿Hacen envíos foráneos?",
    ]);
    expect(r.length).toBe(MAX_SUGERENCIAS);
  });

  it("una respuesta rara de la IA no truena", () => {
    expect(respuestaIaSchema.parse({ sugerencias: "nada" }).sugerencias).toEqual([]);
    expect(respuestaIaSchema.parse({}).sugerencias).toEqual([]);
    expect(limpiarSugerencias([{ pregunta: 42, respuesta: null }], [])).toEqual([]);
  });
});

describe("armarPrompt", () => {
  it("lleva el conocimiento, marca el traspaso y dice quién habla", () => {
    const { system, user } = armarPrompt({
      nombreNegocio: "Tacos Ana",
      conocimiento: [{ pregunta: "¿Horario?", respuesta: "9 a 6" }],
      bloques: ["Estamos en el centro"],
      mensajes: [
        { quien: "cliente", texto: "¿Aceptan tarjeta?", despuesDelTraspaso: false },
        { quien: "agente", texto: "Te paso con alguien", despuesDelTraspaso: false },
        { quien: "persona", texto: "Sí, Visa y Mastercard", despuesDelTraspaso: true },
      ],
    });
    expect(system).toContain("Tacos Ana");
    expect(system).toContain('"sugerencias"');
    expect(user).toContain("P: ¿Horario? / R: 9 a 6");
    expect(user).toContain("Estamos en el centro");
    expect(user.indexOf("aquí el agente pasó")).toBeLessThan(user.indexOf("EQUIPO: Sí, Visa"));
    expect(user.indexOf("AGENTE (IA): Te paso")).toBeLessThan(user.indexOf("aquí el agente pasó"));
  });

  it("sin conocimiento lo dice", () => {
    const { user } = armarPrompt({ nombreNegocio: "", conocimiento: [], bloques: [], mensajes: [] });
    expect(user).toContain("(vacío)");
    expect(user).toContain("(sin mensajes)");
  });
});

describe("varios", () => {
  it("config por defecto: encendido", () => {
    expect(configSchema.parse({})).toEqual(CONFIG_POR_DEFECTO);
    expect(CONFIG_POR_DEFECTO.activo).toBe(true);
  });

  it("textoDeMensaje compacta y nombra adjuntos", () => {
    expect(textoDeMensaje("text", "  hola \n que tal ")).toBe("hola que tal");
    expect(textoDeMensaje("audio", null)).toBe("[nota de voz]");
    expect(textoDeMensaje("document", "")).toBe("[document]");
  });
});
