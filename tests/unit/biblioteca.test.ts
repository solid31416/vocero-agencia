import { describe, expect, it } from "vitest";
import {
  MAX_ENVIOS_POR_DIA,
  MAX_VECES_POR_ARCHIVO,
  bloqueoDeEnvio,
  detectarMime,
  paraElAgente,
  problemaDelArchivo,
  tipoDe,
} from "@/lib/biblioteca";
import { HERRAMIENTAS, herramientasEfectivas } from "@/lib/agent-roles";
import { settingsSections } from "@/lib/nav";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

describe("biblioteca: qué archivo es de verdad", () => {
  it("reconoce JPG, PNG, PDF y MP4 por sus primeros bytes", () => {
    expect(detectarMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectarMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(detectarMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    const mp4 = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
    expect(detectarMime(mp4)).toBe("video/mp4");
  });

  it("un .MOV de iPhone se distingue y se explica", () => {
    const mov = bytes(0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20);
    expect(detectarMime(mov)).toBe("video/quicktime");
    expect(problemaDelArchivo("video/quicktime", 1000)).toMatch(/MP4/);
  });

  it("un archivo cualquiera renombrado no pasa", () => {
    expect(detectarMime(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // un .zip
    expect(problemaDelArchivo(null, 1000)).toMatch(/no se puede mandar/);
  });

  it("respeta los límites de WhatsApp", () => {
    expect(problemaDelArchivo("image/jpeg", 4 * 1024 * 1024)).toBeNull();
    expect(problemaDelArchivo("image/jpeg", 6 * 1024 * 1024)).toMatch(/5 MB/);
    expect(problemaDelArchivo("video/mp4", 17 * 1024 * 1024)).toMatch(/16 MB/);
    expect(problemaDelArchivo("application/pdf", 0)).toMatch(/vacío/);
    expect(tipoDe("video/mp4")).toBe("video");
    expect(tipoDe("application/pdf")).toBe("documento");
  });
});

describe("biblioteca: lo que ve y puede hacer el agente", () => {
  const archivos = [
    { id: "bib_1", titulo: "Ventanal de noche", cuando: "Si preguntan por la vista", tipo: "foto" as const, activo: true },
    { id: "bib_2", titulo: "Ficha técnica", cuando: "", tipo: "documento" as const, activo: false },
    { id: "bib_3", titulo: "Armado en 1 día", cuando: "Si dudan de la instalación", tipo: "video" as const, activo: true },
  ];

  it("solo ve los activos, y sabe cuáles ya mandó", () => {
    const lista = paraElAgente(archivos, new Set(["bib_3"]));
    expect(lista.map((a) => a.id)).toEqual(["bib_1", "bib_3"]);
    expect(lista.find((a) => a.id === "bib_3")?.yaEnviado).toBe(true);
    expect(lista.find((a) => a.id === "bib_1")?.yaEnviado).toBe(false);
  });

  it("deja reenviar un archivo una vez si lo piden, sin pasar del tope", () => {
    expect(bloqueoDeEnvio({ archivoActivo: true, vecesEsteArchivo: 0, enviosHoy: 0 })).toBeNull();
    expect(bloqueoDeEnvio({ archivoActivo: false, vecesEsteArchivo: 0, enviosHoy: 0 })?.codigo).toBe("archivo_apagado");
    // «Reenvíame la foto»: la segunda vez sí sale.
    expect(bloqueoDeEnvio({ archivoActivo: true, vecesEsteArchivo: 1, enviosHoy: 1 })).toBeNull();
    expect(
      bloqueoDeEnvio({ archivoActivo: true, vecesEsteArchivo: MAX_VECES_POR_ARCHIVO, enviosHoy: 2 })?.codigo
    ).toBe("ya_enviado");
    expect(
      bloqueoDeEnvio({ archivoActivo: true, vecesEsteArchivo: 0, enviosHoy: MAX_ENVIOS_POR_DIA })?.codigo
    ).toBe("limite");
  });

  it("la herramienta existe en el catálogo, marcada como de la biblioteca", () => {
    const h = HERRAMIENTAS.find((x) => x.clave === "biblioteca");
    expect(h?.biblioteca).toBe(true);
    // Un perfil sin configurar la tiene; uno que la apagó, no.
    expect(herramientasEfectivas(null)).toContain("biblioteca");
    expect(herramientasEfectivas(["ficha"])).not.toContain("biblioteca");
  });

  it("Ajustes → Biblioteca solo aparece con la bandera", () => {
    const links = (on: boolean) =>
      settingsSections({ biblioteca: on }).flatMap((s) => s.links.map((l) => l.href));
    expect(links(true)).toContain("/settings/biblioteca");
    expect(links(false)).not.toContain("/settings/biblioteca");
  });
});
