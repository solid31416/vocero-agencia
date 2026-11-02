import { z } from "zod";

/**
 * Módulo de la agencia (Treviño AI) — «Nadie ha contestado».
 *
 * Lógica pura (sin base ni red): desde cuándo un cliente espera a una
 * persona, el horario de atención del negocio y cuándo toca avisarle al
 * cliente o al dueño. El revisor y la bandeja la usan igual.
 */

export const DIAS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Dia = (typeof DIAS)[number];

export const NOMBRE_DIA: Record<Dia, string> = {
  mon: "lunes",
  tue: "martes",
  wed: "miércoles",
  thu: "jueves",
  fri: "viernes",
  sat: "sábado",
  sun: "domingo",
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (usa HH:MM)");
export const rangoSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((r) => r.start < r.end, { message: "La hora de cierre debe ser después de la de apertura" });
export type Rango = z.infer<typeof rangoSchema>;
export type Horario = Partial<Record<Dia, Rango[]>>;

export const horarioSchema = z.record(z.enum(DIAS), z.array(rangoSchema).max(4)) as unknown as z.ZodType<
  Horario,
  z.ZodTypeDef,
  unknown
>;

export const HORARIO_POR_DEFECTO: Horario = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
  sat: [{ start: "09:00", end: "14:00" }],
};

export const TEXTO_CLIENTE = "Ya le avisé a mi equipo 🙏 En breve una persona te contesta por aquí.";
export const TEXTO_FUERA =
  "¡Gracias por escribirnos! 🙏 En este momento estamos fuera de horario; una persona te contesta {apertura}.";

/** Si el traspaso es más viejo que esto, ya no se le escribe al cliente (p. ej. al encender el módulo). */
export const MAX_ESPERA_CLIENTE_MS = 2 * 60 * 60 * 1000;
/** Esperas de más de un día ya no se le avisan al dueño (la ventana de 24 h ya cerró). */
export const MAX_ESPERA_DUENO_MS = 24 * 60 * 60 * 1000;

function soloTelefono(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/[^\d+]/g, "");
  return t ? t : null;
}

export const configSchema = z
  .object({
    activo: z.boolean().default(true),
    mensajeCliente: z.boolean().default(true),
    minutosCliente: z.number().int().min(1).max(240).default(10),
    textoCliente: z.string().trim().min(1, "Escribe el mensaje para el cliente").max(500).default(TEXTO_CLIENTE),
    textoFuera: z.string().trim().min(1, "Escribe el mensaje fuera de horario").max(500).default(TEXTO_FUERA),
    avisarDueno: z.boolean().default(false),
    minutosDueno: z.number().int().min(1).max(1440).default(30),
    telefonoDueno: z.string().max(30).nullable().default(null).transform(soloTelefono),
    horario: horarioSchema.default(HORARIO_POR_DEFECTO),
  })
  .superRefine((c, ctx) => {
    if (c.telefonoDueno && c.telefonoDueno.replace(/\D/g, "").length < 10) {
      ctx.addIssue({ code: "custom", path: ["telefonoDueno"], message: "El teléfono debe tener al menos 10 dígitos" });
    }
    if (c.avisarDueno && !c.telefonoDueno) {
      ctx.addIssue({ code: "custom", path: ["telefonoDueno"], message: "Pon el teléfono al que te avisamos" });
    }
  });
export type ConfigEspera = z.output<typeof configSchema>;
export const CONFIG_POR_DEFECTO: ConfigEspera = configSchema.parse({});

/* ---------- Horario ---------- */

const aMinutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Día de la semana y minuto del día en la zona del negocio. */
export function relojLocal(fecha: Date, zona: string): { dia: Dia; minutos: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  const dia = p("weekday").toLowerCase().slice(0, 3) as Dia;
  return { dia: DIAS.includes(dia) ? dia : "mon", minutos: (Number(p("hour")) % 24) * 60 + Number(p("minute")) };
}

export function dentroDeHorario(horario: Horario, fecha: Date, zona: string): boolean {
  const { dia, minutos } = relojLocal(fecha, zona);
  return (horario[dia] ?? []).some((r) => minutos >= aMinutos(r.start) && minutos < aMinutos(r.end));
}

export type Apertura = { enDias: number; dia: Dia; hora: string };

/** Cuándo vuelve a abrir el negocio (la siguiente apertura después de `fecha`). */
export function siguienteApertura(horario: Horario, fecha: Date, zona: string): Apertura | null {
  const { dia, minutos } = relojLocal(fecha, zona);
  const hoy = DIAS.indexOf(dia);
  for (let k = 0; k <= 7; k++) {
    const d = DIAS[(hoy + k) % 7]!;
    const rangos = [...(horario[d] ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    for (const r of rangos) {
      if (k === 0 && aMinutos(r.start) <= minutos) continue;
      return { enDias: k, dia: d, hora: r.start };
    }
  }
  return null;
}

/** «hoy a las 9:00», «mañana a la 1:30», «el lunes a las 9:00». */
export function textoApertura(a: Apertura | null): string {
  if (!a) return "en cuanto podamos";
  const h = Number(a.hora.slice(0, 2));
  const hora = `${h}:${a.hora.slice(3, 5)}`;
  const alas = h === 1 ? "a la" : "a las";
  if (a.enDias === 0) return `hoy ${alas} ${hora}`;
  if (a.enDias === 1) return `mañana ${alas} ${hora}`;
  return `el ${NOMBRE_DIA[a.dia]} ${alas} ${hora}`;
}

export function rellenar(texto: string, valores: { apertura: string }): string {
  return texto.replace(/\{apertura\}/g, valores.apertura);
}

/* ---------- La espera ---------- */

export type CasoEspera = "traspaso" | "sin_respuesta";
export type Espera = { desde: Date; caso: CasoEspera };

/**
 * Desde cuándo espera el cliente a una persona (solo con la IA pausada):
 * - «traspaso»: la conversación se pasó a una persona y nadie ha escrito
 *   desde entonces. Cuenta desde el traspaso, aunque el agente haya dicho
 *   «te paso con alguien» después.
 * - «sin_respuesta»: el cliente escribió y lo último del negocio fue antes.
 * Un traspaso por «manual_reply» lo provocó una persona contestando: no es espera.
 */
export function calcularEspera(f: {
  handoffAt: Date | null;
  handoffReason: string | null;
  ultimaHumana: Date | null;
  primeraEntradaSinRespuesta: Date | null;
}): Espera | null {
  if (
    f.handoffAt &&
    f.handoffReason !== "manual_reply" &&
    (!f.ultimaHumana || f.ultimaHumana.getTime() < f.handoffAt.getTime())
  ) {
    return { desde: f.handoffAt, caso: "traspaso" };
  }
  if (f.primeraEntradaSinRespuesta) return { desde: f.primeraEntradaSinRespuesta, caso: "sin_respuesta" };
  return null;
}

export function decidirAvisos(p: {
  espera: Espera;
  ahora: Date;
  config: ConfigEspera;
  dentroDeHorario: boolean;
  yaCliente: boolean;
  yaDueno: boolean;
}): { cliente: boolean; dueno: boolean } {
  const { espera, config } = p;
  const ms = p.ahora.getTime() - espera.desde.getTime();
  const min = ms / 60_000;
  return {
    cliente:
      config.activo &&
      config.mensajeCliente &&
      espera.caso === "traspaso" &&
      !p.yaCliente &&
      min >= config.minutosCliente &&
      ms <= config.minutosCliente * 60_000 + MAX_ESPERA_CLIENTE_MS,
    dueno:
      config.activo &&
      config.avisarDueno &&
      Boolean(config.telefonoDueno) &&
      !p.yaDueno &&
      p.dentroDeHorario &&
      min >= config.minutosDueno &&
      ms <= MAX_ESPERA_DUENO_MS,
  };
}

/** «12 min», «1 h 5 min», «3 h». */
export function duracion(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function textoParaDueno(p: { nombre: string; esperaMs: number; ultimo: string; enlace: string }): string {
  const ultimo = p.ultimo.length > 140 ? `${p.ultimo.slice(0, 140)}…` : p.ultimo;
  return [
    `${p.nombre || "Un cliente"} lleva ${duracion(p.esperaMs)} esperando a una persona.`,
    ultimo ? `Último mensaje: «${ultimo}»` : "",
    `Ábrelo: ${p.enlace}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------- Lo que ve la bandeja ---------- */

export type EsperaDto = {
  desde: string;
  caso: CasoEspera;
  avisoClienteEn: string | null;
  avisoDuenoEn: string | null;
};

export type MapaEspera = {
  activo: boolean;
  minutosDueno: number;
  conversaciones: Record<string, EsperaDto>;
};
