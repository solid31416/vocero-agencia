import { describe, expect, it } from "vitest";
import {
  MAX_AL_DIA,
  MAX_TEXTO_AL_DIA,
  parsePonerAlDiaFlag,
  seleccionarAlDia,
  type FilaAlDia,
} from "@/server/brains/ponerse-al-dia";
import { armarEvento } from "@/server/brains/contract";

/**
 * Módulo de la agencia — Ponerse al día: qué viaja en `ponerseAlDia` y que la
 * clave no aparezca cuando no hay nada (el cuerpo gemelo del contrato no
 * cambia).
 */

let n = 0;
function fila(
  direction: "in" | "out",
  text: string | null,
  extra: Partial<FilaAlDia> = {}
): FilaAlDia {
  n += 1;
  return {
    id: `msg_${n}`,
    direction,
    aiGenerated: false,
    type: "text",
    text,
    caption: null,
    createdAt: new Date(Date.UTC(2026, 9, 29, 0, 0, n)),
    ...extra,
  };
}

describe("parsePonerAlDiaFlag", () => {
  it("apagada por defecto; `on` y sus sinónimos la encienden", () => {
    expect(parsePonerAlDiaFlag(undefined)).toBe(false);
    expect(parsePonerAlDiaFlag("off")).toBe(false);
    expect(parsePonerAlDiaFlag("onn")).toBe(false);
    for (const v of ["on", " ON ", "1", "true", "sí", "yes"]) {
      expect(parsePonerAlDiaFlag(v)).toBe(true);
    }
  });
});

describe("seleccionarAlDia", () => {
  it("toma lo posterior a la última respuesta del agente, con quién lo dijo", () => {
    const cliente1 = fila("in", "¿cuánto cuesta?");
    const agente = fila("out", "Desde $600 al mes", { aiGenerated: true });
    const equipo = fila("out", "Te lo dejo en $500");
    const cliente2 = fila("in", "ok gracias");
    const rafaga = fila("in", "¿entonces son $500?");
    const al = seleccionarAlDia(
      [cliente1, agente, equipo, cliente2, rafaga],
      [rafaga.id]
    );
    expect(al.map((m) => [m.de, m.texto])).toEqual([
      ["equipo", "Te lo dejo en $500"],
      ["cliente", "ok gracias"],
    ]);
    expect(al[0]?.at).toBe(equipo.createdAt.toISOString());
  });

  it("sin respuesta del agente, toma todo lo que no viaja en la ráfaga", () => {
    const a = fila("out", "Hola, soy Saúl");
    const b = fila("in", "hola");
    expect(seleccionarAlDia([a, b], [b.id]).map((m) => m.texto)).toEqual([
      "Hola, soy Saúl",
    ]);
  });

  it("si el agente habló al último, no hay nada que contar", () => {
    const a = fila("in", "hola");
    const b = fila("out", "¡Hola!", { aiGenerated: true });
    expect(seleccionarAlDia([a, b], [])).toEqual([]);
  });

  it("un adjunto sin texto se cuenta por su tipo; el pie de foto gana", () => {
    const agente = fila("out", "listo", { aiGenerated: true });
    const foto = fila("out", null, { type: "image" });
    const conPie = fila("in", null, { type: "image", caption: "mi recibo" });
    const raro = fila("in", null, { type: "reaction" });
    expect(
      seleccionarAlDia([agente, foto, conPie, raro], []).map((m) => m.texto)
    ).toEqual(["[envió una imagen]", "mi recibo"]);
  });

  it("recorta textos largos y se queda con los más recientes", () => {
    const largo = fila("out", "x".repeat(MAX_TEXTO_AL_DIA + 50));
    const muchos = Array.from({ length: MAX_AL_DIA + 5 }, (_, i) =>
      fila("in", `m${i}`)
    );
    const al = seleccionarAlDia([largo, ...muchos], []);
    expect(al).toHaveLength(MAX_AL_DIA);
    expect(al.at(-1)?.texto).toBe(`m${MAX_AL_DIA + 4}`);
    const soloLargo = seleccionarAlDia([largo], []);
    expect(soloLargo[0]?.texto).toHaveLength(MAX_TEXTO_AL_DIA + 1);
  });
});

describe("armarEvento con ponerseAlDia", () => {
  const base = {
    dispatchId: "dsp_1",
    organization: { id: "org_1", slug: "demo" },
    conversation: {
      id: "cv_1",
      channel: "whatsapp" as const,
      aiEnabled: true,
      windowOpen: true,
      windowExpiresAt: null,
    },
    contact: { id: "ct_1", displayName: "J", identity: "5218100000000" },
    messages: [],
    firstMessageAt: new Date(Date.UTC(2026, 9, 29)),
    lastMessageAt: new Date(Date.UTC(2026, 9, 29)),
  };

  it("sin nada que contar, la clave no existe (el cuerpo gemelo no cambia)", () => {
    expect("ponerseAlDia" in armarEvento(base)).toBe(false);
    expect("ponerseAlDia" in armarEvento({ ...base, ponerseAlDia: [] })).toBe(false);
  });

  it("con algo que contar, va al final del evento", () => {
    const al = [
      { id: "msg_9", at: "2026-10-29T00:00:00.000Z", de: "equipo" as const, texto: "hola" },
    ];
    const evento = armarEvento({ ...base, ponerseAlDia: al });
    expect(evento.ponerseAlDia).toEqual(al);
    expect(Object.keys(evento).at(-1)).toBe("ponerseAlDia");
  });
});
