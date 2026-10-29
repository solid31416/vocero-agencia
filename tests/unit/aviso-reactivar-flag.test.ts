import { afterEach, describe, expect, it } from "vitest";
import { avisoReactivarEnabled } from "@/server/inbox/aviso-reactivar-flag";

/**
 * Módulo de la agencia — la bandera del aviso al reactivar la IA. Sin la
 * variable, la bandeja reactiva directo, igual que el Vocero raíz.
 */

const original = process.env.AVISAR_AL_REACTIVAR_IA;
afterEach(() => {
  if (original === undefined) delete process.env.AVISAR_AL_REACTIVAR_IA;
  else process.env.AVISAR_AL_REACTIVAR_IA = original;
});

describe("avisoReactivarEnabled", () => {
  it("sin variable, el módulo está apagado", () => {
    delete process.env.AVISAR_AL_REACTIVAR_IA;
    expect(avisoReactivarEnabled()).toBe(false);
  });

  it("`on` lo enciende y `off` lo apaga", () => {
    process.env.AVISAR_AL_REACTIVAR_IA = " On ";
    expect(avisoReactivarEnabled()).toBe(true);
    process.env.AVISAR_AL_REACTIVAR_IA = "off";
    expect(avisoReactivarEnabled()).toBe(false);
  });
});
