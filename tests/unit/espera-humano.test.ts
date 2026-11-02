import { describe, expect, it } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  HORARIO_POR_DEFECTO,
  MAX_ESPERA_CLIENTE_MS,
  calcularEspera,
  configSchema,
  decidirAvisos,
  dentroDeHorario,
  duracion,
  rellenar,
  relojLocal,
  siguienteApertura,
  textoApertura,
  textoParaDueno,
} from "@/lib/espera-humano";

const ZONA = "America/Mexico_City"; // UTC-6, sin horario de verano
// Lunes 2 de noviembre de 2026.
const mx = (dia: number, hora: string) => new Date(`2026-11-${String(dia).padStart(2, "0")}T${hora}:00-06:00`);

describe("horario", () => {
  it("relojLocal usa la zona del negocio", () => {
    expect(relojLocal(mx(2, "10:30"), ZONA)).toEqual({ dia: "mon", minutos: 630 });
    expect(relojLocal(mx(8, "23:59"), ZONA)).toEqual({ dia: "sun", minutos: 1439 });
  });

  it("dentroDeHorario: abre incluido, cierra excluido, domingo cerrado", () => {
    expect(dentroDeHorario(HORARIO_POR_DEFECTO, mx(2, "09:00"), ZONA)).toBe(true);
    expect(dentroDeHorario(HORARIO_POR_DEFECTO, mx(2, "18:00"), ZONA)).toBe(false);
    expect(dentroDeHorario(HORARIO_POR_DEFECTO, mx(7, "13:59"), ZONA)).toBe(true);
    expect(dentroDeHorario(HORARIO_POR_DEFECTO, mx(8, "12:00"), ZONA)).toBe(false);
  });

  it("siguienteApertura + textoApertura", () => {
    expect(textoApertura(siguienteApertura(HORARIO_POR_DEFECTO, mx(2, "07:00"), ZONA))).toBe("hoy a las 9:00");
    expect(textoApertura(siguienteApertura(HORARIO_POR_DEFECTO, mx(2, "20:00"), ZONA))).toBe("mañana a las 9:00");
    // Sábado en la tarde → lunes.
    expect(textoApertura(siguienteApertura(HORARIO_POR_DEFECTO, mx(7, "15:00"), ZONA))).toBe("el lunes a las 9:00");
    expect(textoApertura(siguienteApertura({ tue: [{ start: "13:30", end: "15:00" }] }, mx(2, "20:00"), ZONA))).toBe(
      "mañana a las 13:30"
    );
    expect(textoApertura(siguienteApertura({ mon: [{ start: "01:00", end: "02:00" }] }, mx(2, "00:10"), ZONA))).toBe(
      "hoy a la 1:00"
    );
    expect(textoApertura(siguienteApertura({}, mx(2, "20:00"), ZONA))).toBe("en cuanto podamos");
  });

  it("rellenar", () => {
    expect(rellenar("Te contestamos {apertura}.", { apertura: "mañana a las 9:00" })).toBe(
      "Te contestamos mañana a las 9:00."
    );
  });
});

describe("configSchema", () => {
  it("por defecto: encendido, mensaje al cliente a los 10 min, sin aviso al dueño", () => {
    expect(CONFIG_POR_DEFECTO.activo).toBe(true);
    expect(CONFIG_POR_DEFECTO.mensajeCliente).toBe(true);
    expect(CONFIG_POR_DEFECTO.minutosCliente).toBe(10);
    expect(CONFIG_POR_DEFECTO.avisarDueno).toBe(false);
    expect(CONFIG_POR_DEFECTO.horario).toEqual(HORARIO_POR_DEFECTO);
  });

  it("teléfono: limpia y exige 10 dígitos; avisar sin teléfono no pasa", () => {
    expect(configSchema.parse({ telefonoDueno: "+52 (81) 1234-5678" }).telefonoDueno).toBe("+528112345678");
    expect(configSchema.parse({ telefonoDueno: "  " }).telefonoDueno).toBeNull();
    expect(configSchema.safeParse({ telefonoDueno: "12345" }).success).toBe(false);
    expect(configSchema.safeParse({ avisarDueno: true }).success).toBe(false);
  });

  it("horario: rechaza horas al revés o inválidas", () => {
    expect(configSchema.safeParse({ horario: { mon: [{ start: "18:00", end: "09:00" }] } }).success).toBe(false);
    expect(configSchema.safeParse({ horario: { mon: [{ start: "9:00", end: "18:00" }] } }).success).toBe(false);
    expect(configSchema.safeParse({ horario: { xyz: [] } }).success).toBe(false);
  });
});

describe("calcularEspera", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 2, 16, min));

  it("traspaso sin respuesta de una persona: cuenta desde el traspaso", () => {
    expect(
      calcularEspera({ handoffAt: t(10), handoffReason: "cliente", ultimaHumana: t(1), primeraEntradaSinRespuesta: null })
    ).toEqual({ desde: t(10), caso: "traspaso" });
  });

  it("si una persona ya contestó, solo espera si el cliente volvió a escribir", () => {
    const base = { handoffAt: t(10), handoffReason: "cliente", ultimaHumana: t(15) };
    expect(calcularEspera({ ...base, primeraEntradaSinRespuesta: null })).toBeNull();
    expect(calcularEspera({ ...base, primeraEntradaSinRespuesta: t(20) })).toEqual({ desde: t(20), caso: "sin_respuesta" });
  });

  it("«manual_reply» lo provocó una persona contestando: no es traspaso", () => {
    expect(
      calcularEspera({ handoffAt: t(10), handoffReason: "manual_reply", ultimaHumana: null, primeraEntradaSinRespuesta: null })
    ).toBeNull();
  });

  it("pausa a mano sin traspaso: cuenta desde el primer mensaje sin respuesta", () => {
    expect(
      calcularEspera({ handoffAt: null, handoffReason: null, ultimaHumana: null, primeraEntradaSinRespuesta: t(30) })
    ).toEqual({ desde: t(30), caso: "sin_respuesta" });
  });
});

describe("decidirAvisos", () => {
  const desde = new Date("2026-11-02T16:00:00Z");
  const min = (m: number) => new Date(desde.getTime() + m * 60_000);
  const config = { ...CONFIG_POR_DEFECTO, avisarDueno: true, telefonoDueno: "+528112345678", minutosDueno: 30 };
  const base = { espera: { desde, caso: "traspaso" as const }, config, dentroDeHorario: true, yaCliente: false, yaDueno: false };

  it("al cliente a los 10 min, una vez, solo en traspasos", () => {
    expect(decidirAvisos({ ...base, ahora: min(9) }).cliente).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(10) }).cliente).toBe(true);
    expect(decidirAvisos({ ...base, ahora: min(10), yaCliente: true }).cliente).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(10), espera: { desde, caso: "sin_respuesta" } }).cliente).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(10), config: { ...config, mensajeCliente: false } }).cliente).toBe(false);
  });

  it("al cliente no, si el traspaso es viejo (p. ej. al encender el módulo)", () => {
    const tarde = new Date(desde.getTime() + 10 * 60_000 + MAX_ESPERA_CLIENTE_MS + 1);
    expect(decidirAvisos({ ...base, ahora: tarde }).cliente).toBe(false);
  });

  it("al dueño a los 30 min, solo en horario y con teléfono", () => {
    expect(decidirAvisos({ ...base, ahora: min(29) }).dueno).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(30) }).dueno).toBe(true);
    expect(decidirAvisos({ ...base, ahora: min(30), dentroDeHorario: false }).dueno).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(30), yaDueno: true }).dueno).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(30), config: { ...config, telefonoDueno: null } }).dueno).toBe(false);
    expect(decidirAvisos({ ...base, ahora: min(25 * 60) }).dueno).toBe(false);
  });

  it("apagado: nada", () => {
    expect(decidirAvisos({ ...base, ahora: min(60), config: { ...config, activo: false } })).toEqual({
      cliente: false,
      dueno: false,
    });
  });
});

describe("textos", () => {
  it("duracion", () => {
    expect(duracion(30_000)).toBe("0 min");
    expect(duracion(12 * 60_000)).toBe("12 min");
    expect(duracion(65 * 60_000)).toBe("1 h 5 min");
    expect(duracion(180 * 60_000)).toBe("3 h");
  });

  it("textoParaDueno", () => {
    const t = textoParaDueno({ nombre: "Ana", esperaMs: 35 * 60_000, ultimo: "¿Me ayudan?", enlace: "https://crm/x" });
    expect(t).toBe("Ana lleva 35 min esperando a una persona.\nÚltimo mensaje: «¿Me ayudan?»\nÁbrelo: https://crm/x");
  });
});
