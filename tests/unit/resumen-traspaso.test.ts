import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  MAX_CARACTERES_MENSAJE,
  MAX_MENSAJES,
  RENGLONES,
  armarPrompt,
  configSchema,
  resumenSchema,
  textoAviso,
  textoDeMensaje,
  textoMotivo,
} from "@/lib/resumen-traspaso";

describe("resumenSchema", () => {
  it("acepta la respuesta normal de la IA", () => {
    const r = resumenSchema.parse({
      quien: " Ana, dueña de un restaurante ",
      quiere: "Cotizar",
      yaSeDijo: "Precio base",
      falta: "Descuento",
      animo: "Con prisa",
    });
    expect(r.quien).toBe("Ana, dueña de un restaurante");
  });

  it("un campo raro o faltante queda vacío, no tumba el resumen", () => {
    const r = resumenSchema.parse({ quien: 42, quiere: null, falta: "Llamarle" });
    expect(r).toEqual({ quien: "", quiere: "", yaSeDijo: "", falta: "Llamarle", animo: "" });
  });

  it("recorta campos larguísimos", () => {
    const r = resumenSchema.parse({ quien: "x".repeat(2000) });
    expect(r.quien.length).toBe(300);
  });

  it("los renglones cubren todos los campos", () => {
    expect(RENGLONES.map((r) => r.campo).sort()).toEqual(Object.keys(resumenSchema.shape).sort());
  });
});

describe("configSchema", () => {
  it("por defecto: encendido y sin aviso por WhatsApp", () => {
    expect(configSchema.parse({})).toEqual(CONFIG_POR_DEFECTO);
    expect(CONFIG_POR_DEFECTO.activo).toBe(true);
    expect(CONFIG_POR_DEFECTO.avisarDueno).toBe(false);
  });

  it("limpia el teléfono y exige lada", () => {
    expect(configSchema.parse({ telefonoDueno: "+52 (81) 1234-5678" }).telefonoDueno).toBe("528112345678");
    expect(configSchema.parse({ telefonoDueno: "  " }).telefonoDueno).toBeNull();
    expect(configSchema.parse({ telefonoDueno: null }).telefonoDueno).toBeNull();
    expect(configSchema.safeParse({ telefonoDueno: "12345" }).success).toBe(false);
  });
});

describe("textoMotivo", () => {
  it("dice el motivo para personas, con respaldo", () => {
    expect(textoMotivo("cliente")).toContain("pidió hablar con una persona");
    expect(textoMotivo("manual")).toContain("pausó la IA");
    expect(textoMotivo("pedido")).toContain("la IA sigue contestando");
    expect(textoMotivo("algo-raro")).toBe("Se pasó a una persona");
    expect(textoMotivo(null)).toBe("Se pasó a una persona");
  });
});

describe("textoDeMensaje", () => {
  it("compacta espacios y recorta", () => {
    expect(textoDeMensaje("text", "  hola \n\n  qué tal ")).toBe("hola qué tal");
    expect(textoDeMensaje("text", "a".repeat(900)).length).toBe(MAX_CARACTERES_MENSAJE);
  });

  it("nombra los adjuntos sin texto", () => {
    expect(textoDeMensaje("audio", null)).toBe("[nota de voz]");
    expect(textoDeMensaje("image", "")).toBe("[imagen]");
    expect(textoDeMensaje("raro", null)).toBe("[mensaje sin texto]");
    expect(textoDeMensaje("image", "mira esto")).toBe("mira esto");
  });
});

describe("armarPrompt", () => {
  it("lleva contacto, ficha, motivo y la plática en orden con quién habla", () => {
    const { system, user } = armarPrompt({
      nombreContacto: "Ana",
      ficha: { negocio: "Tacos Ana" },
      motivo: "cliente",
      mensajes: [
        { quien: "cliente", texto: "Hola" },
        { quien: "agente", texto: "¿En qué te ayudo?" },
        { quien: "persona", texto: "Soy Saúl" },
      ],
    });
    expect(system).toContain('"yaSeDijo"');
    expect(user).toContain("Contacto: Ana");
    expect(user).toContain("Tacos Ana");
    expect(user).toContain("pidió hablar con una persona");
    expect(user.indexOf("CLIENTE: Hola")).toBeLessThan(user.indexOf("AGENTE (IA): ¿En qué te ayudo?"));
    expect(user).toContain("EQUIPO: Soy Saúl");
  });

  it("solo los últimos mensajes y sin ficha vacía", () => {
    const mensajes = Array.from({ length: MAX_MENSAJES + 10 }, (_, i) => ({
      quien: "cliente" as const,
      texto: `m${i}`,
    }));
    const { user } = armarPrompt({ nombreContacto: "", ficha: {}, motivo: "modelo", mensajes });
    expect(user).not.toContain("CLIENTE: m0\n");
    expect(user).toContain(`CLIENTE: m${MAX_MENSAJES + 9}`);
    expect(user).not.toContain("Ficha");
    expect(user).toContain("sin nombre");
  });
});

describe("textoAviso", () => {
  it("aviso corto con lo que quiere, lo que falta y el link", () => {
    const t = textoAviso({
      nombreContacto: "Ana",
      motivo: "cliente",
      enlace: "https://crm/inbox?conversation=cv_1",
      resumen: { quien: "Ana", quiere: "Cotizar", yaSeDijo: "", falta: "Darle descuento", animo: "" },
    });
    expect(t).toContain("🙋 Ana necesita a una persona");
    expect(t).toContain("Quiere: Cotizar");
    expect(t).toContain("Falta: Darle descuento");
    expect(t).toContain("https://crm/inbox?conversation=cv_1");
  });

  it("se salta lo que no se sabe", () => {
    const t = textoAviso({
      nombreContacto: "",
      motivo: "modelo",
      enlace: "x",
      resumen: { quien: "", quiere: "—", yaSeDijo: "", falta: "", animo: "" },
    });
    expect(t).toContain("Un cliente necesita");
    expect(t).not.toContain("Quiere:");
    expect(t).not.toContain("Falta:");
  });
});
