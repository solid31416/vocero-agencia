import { z } from "zod";
import { todayInTz, zonedWallClockToUtc } from "@/lib/time/slots";

/**
 * Módulo de la agencia (Treviño AI) — Contador de mensajes y costo de Meta.
 *
 * Desde el 1 de octubre de 2026 Meta cobra TODO mensaje entregado de la empresa
 * al cliente (lo que escribe el cliente es gratis). Las respuestas normales
 * («servicio») traen 1,000 gratis al mes por número; las plantillas se cobran
 * siempre. Sin tarjeta en Meta, pasando las 1,000 deja de ENTREGAR: el agente
 * cree que contestó y al cliente no le llega nada.
 *
 * Este archivo es puro (pantalla y servidor): tarifas, cómo se cuenta y cómo
 * se resume un mes.
 */

export const GRATIS_SERVICIO = 1000;

export const CATEGORIAS = ["service", "utility", "marketing", "authentication"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Tarifas de Meta para México, MXN por mensaje entregado (vigentes desde el 1 oct 2026). */
export const TARIFAS_MX: Record<Categoria, number> = {
  service: 0.1565,
  utility: 0.1565,
  marketing: 0.7298,
  authentication: 0.1565,
};
export const TARIFAS_VIGENCIA = "1 de octubre de 2026";

export const NOMBRE_CATEGORIA: Record<Categoria, string> = {
  service: "Respuestas",
  utility: "Plantillas de Utilidad",
  marketing: "Plantillas de Marketing",
  authentication: "Plantillas de Autenticación",
};

/** Errores de Meta que significan «no hay cómo cobrarte»: la cuenta no tiene pago válido. */
export const CODIGOS_FALLO_PAGO = new Set([131042]);

const precio = z.number().min(0).max(100);
export const configSchema = z.object({
  alertaPct: z.number().int().min(50).max(100),
  /** Teléfono del dueño para el aviso por WhatsApp; null = solo en el CRM. */
  telefonoDueno: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .pipe(z.string().min(10, "Escribe el teléfono con lada, por ejemplo 5281…").max(15))
    .nullable(),
  /** Plantilla aprobada para avisar al dueño si su ventana de 24 h está cerrada. */
  plantillaId: z.string().trim().min(1).nullable(),
  tarifas: z.object({
    service: precio,
    utility: precio,
    marketing: precio,
    authentication: precio,
  }),
});
export type ConfigContador = z.infer<typeof configSchema>;

export const CONFIG_POR_DEFECTO: ConfigContador = {
  alertaPct: 80,
  telefonoDueno: null,
  plantillaId: null,
  tarifas: { ...TARIFAS_MX },
};

/** La categoría de Meta normalizada («SERVICE», «marketing_lite»…) o null si no la conocemos. */
export function normalizarCategoria(c: string | null | undefined): Categoria | null {
  const v = (c ?? "").toLowerCase();
  if (v === "marketing_lite") return "marketing";
  return (CATEGORIAS as readonly string[]).includes(v) ? (v as Categoria) : null;
}

/** De dónde salió un mensaje: Nea, una persona del CRM o del teléfono, o una plantilla. */
export type Origen = "ai" | "operator" | "manual" | "template";

/** Un mensaje entregado del mes, como lo junta el servidor. */
export type FilaMensaje = {
  /** Día del mes en la zona del negocio (1–31). */
  dia: number;
  origen: Origen;
  /** Lo que dijo Meta en el aviso de entrega; null si no lo trajo (o es de antes del módulo). */
  categoria: Categoria | null;
  /** «regular», «free_customer_service», «free_entry_point»… null si no se sabe. */
  tipo: string | null;
};

/** Sin dato de Meta: una plantilla se cuenta como Utilidad (la más común) y lo demás como respuesta. */
export function categoriaDe(f: Pick<FilaMensaje, "categoria" | "origen">): Categoria {
  return f.categoria ?? (f.origen === "template" ? "utility" : "service");
}

export type Estado = "bien" | "cerca" | "cobra" | "no_entrega";

export type ResumenMes = {
  dia: number;
  diasMes: number;
  servicio: { usadas: number; gratis: number; cobradas: number };
  plantillas: Record<Exclude<Categoria, "service">, number>;
  /** Costo estimado con la tabla de tarifas. */
  costo: number;
  desglose: { categoria: Categoria; cantidad: number; precio: number; total: number }[];
  /** Si sigue al mismo ritmo, cuánto cerraría el mes. */
  proyeccion: { respuestas: number; costo: number; diaQueSeAcaban: number | null };
  porDia: { dia: number; nea: number; personas: number; plantillas: number }[];
  porOrigen: { nea: number; personas: number; plantillas: number };
  estado: Estado;
  fallosPago: number;
  /**
   * Lo que el reporte oficial de Meta cuenta y el CRM no: mensajes de
   * conversaciones que se borraron o que salieron por fuera del CRM. Se suman
   * al conteo (Meta es quien cobra), pero no tienen día ni quién los mandó.
   */
  fueraDelCrm: { respuestas: number; plantillas: number };
};

const redondea = (n: number) => Math.round(n * 100) / 100;

/**
 * Resume el mes. Las respuestas gratis se cuentan primero (Meta regala las
 * primeras 1,000 del mes): cuando Meta dice el tipo («regular» = se cobró) se
 * usa ese dato; si no, lo que pase de 1,000.
 */
export function resumirMes(
  filas: readonly FilaMensaje[],
  opts: {
    dia: number;
    diasMes: number;
    tarifas: Record<Categoria, number>;
    alertaPct: number;
    fallosPago?: number;
    /** Lo que dice el reporte oficial de Meta; si es más que lo del CRM, manda Meta. */
    minimos?: { respuestas: number; plantillas: number } | null;
  }
): ResumenMes {
  const cuenta: Record<Categoria, number> = { service: 0, utility: 0, marketing: 0, authentication: 0 };
  let servicioRegularDeMeta = 0;
  let servicioConTipo = 0;
  const porDia = Array.from({ length: opts.diasMes }, (_, i) => ({ dia: i + 1, nea: 0, personas: 0, plantillas: 0 }));
  const porOrigen = { nea: 0, personas: 0, plantillas: 0 };

  for (const f of filas) {
    const cat = categoriaDe(f);
    cuenta[cat] += 1;
    if (cat === "service" && f.tipo) {
      servicioConTipo += 1;
      if (f.tipo === "regular") servicioRegularDeMeta += 1;
    }
    const quien = f.origen === "template" || cat !== "service" ? "plantillas" : f.origen === "ai" ? "nea" : "personas";
    porOrigen[quien] += 1;
    const d = porDia[Math.min(Math.max(f.dia, 1), opts.diasMes) - 1];
    if (d) d[quien] += 1;
  }

  // Meta cobra lo que ELLA cuenta: si su reporte trae más, la diferencia se suma (sin día ni origen).
  const fueraDelCrm = {
    respuestas: Math.max(0, (opts.minimos?.respuestas ?? 0) - cuenta.service),
    plantillas: Math.max(
      0,
      (opts.minimos?.plantillas ?? 0) - (cuenta.utility + cuenta.marketing + cuenta.authentication)
    ),
  };
  cuenta.service += fueraDelCrm.respuestas;
  cuenta.utility += fueraDelCrm.plantillas;

  const usadas = cuenta.service;
  // Lo que Meta marcó como cobrado manda; a las que no traen tipo se les aplica la regla de las 1,000.
  const sinTipo = usadas - servicioConTipo;
  const cobradasPorRegla = Math.max(0, Math.min(sinTipo, usadas - GRATIS_SERVICIO));
  const cobradas = Math.min(usadas, servicioRegularDeMeta + cobradasPorRegla);
  const servicio = { usadas, gratis: usadas - cobradas, cobradas };

  const desglose = CATEGORIAS.map((categoria) => {
    const cantidad = categoria === "service" ? cobradas : cuenta[categoria];
    const p = opts.tarifas[categoria];
    return { categoria, cantidad, precio: p, total: redondea(cantidad * p) };
  });
  const costo = redondea(desglose.reduce((s, d) => s + d.total, 0));

  const dia = Math.max(1, Math.min(opts.dia, opts.diasMes));
  const ritmo = usadas / dia;
  const respuestasFin = Math.round(ritmo * opts.diasMes);
  const plantillasFin = (n: number) => (n / dia) * opts.diasMes;
  const costoFin = redondea(
    Math.max(0, respuestasFin - GRATIS_SERVICIO) * opts.tarifas.service +
      plantillasFin(cuenta.utility) * opts.tarifas.utility +
      plantillasFin(cuenta.marketing) * opts.tarifas.marketing +
      plantillasFin(cuenta.authentication) * opts.tarifas.authentication
  );
  const diaQueSeAcaban =
    usadas >= GRATIS_SERVICIO ? null : ritmo > 0 && GRATIS_SERVICIO / ritmo <= opts.diasMes ? Math.ceil(GRATIS_SERVICIO / ritmo) : null;

  const fallosPago = opts.fallosPago ?? 0;
  const estado: Estado =
    fallosPago > 0
      ? "no_entrega"
      : usadas >= GRATIS_SERVICIO
        ? "cobra"
        : usadas >= (GRATIS_SERVICIO * opts.alertaPct) / 100
          ? "cerca"
          : "bien";

  return {
    dia,
    diasMes: opts.diasMes,
    servicio,
    plantillas: { utility: cuenta.utility, marketing: cuenta.marketing, authentication: cuenta.authentication },
    costo,
    desglose,
    proyeccion: { respuestas: respuestasFin, costo: costoFin, diaQueSeAcaban },
    porDia,
    porOrigen,
    estado,
    fallosPago,
    fueraDelCrm,
  };
}

/** El aviso de Meta oficial, ya sumado: respuestas y costo del mes según su reporte. */
export type CostoOficial = {
  mes: string;
  moneda: string | null;
  costo: number;
  respuestas: number;
  plantillas: number;
  actualizadoEn: string;
};

/** Suma los puntos del reporte `pricing_analytics` de Meta. */
export function sumarReporteMeta(
  puntos: readonly { pricing_category?: string; pricing_type?: string; volume?: number; cost?: number }[]
): { costo: number; respuestas: number; plantillas: number } {
  let costo = 0;
  let respuestas = 0;
  let plantillas = 0;
  for (const p of puntos) {
    const cat = normalizarCategoria(p.pricing_category);
    const v = Number(p.volume) || 0;
    costo += Number(p.cost) || 0;
    if (cat === "service") respuestas += v;
    else if (cat) plantillas += v;
  }
  return { costo: redondea(costo), respuestas, plantillas };
}

/** Qué decirle al dueño en el aviso. `null` = nada que avisar. */
export function textoAviso(r: Pick<ResumenMes, "estado" | "servicio" | "fallosPago">, alertaPct: number): string | null {
  const n = r.servicio.usadas.toLocaleString("es-MX");
  switch (r.estado) {
    case "no_entrega":
      return `Meta no está entregando mensajes de tu WhatsApp por un problema de pago (${r.fallosPago} este mes). Tus clientes no reciben las respuestas: revisa la tarjeta en Meta → Facturación y pagos.`;
    case "cobra":
      return `Tu WhatsApp ya usó las ${GRATIS_SERVICIO.toLocaleString("es-MX")} respuestas gratis del mes (llevas ${n}). Desde ahora cada respuesta cuesta. Si tu cuenta de Meta no tiene tarjeta, dejarán de entregarse.`;
    case "cerca":
      return `Tu WhatsApp lleva ${n} de ${GRATIS_SERVICIO.toLocaleString("es-MX")} respuestas gratis este mes (${alertaPct}% o más). Al pasar de ${GRATIS_SERVICIO.toLocaleString("es-MX")} se cobran, y sin tarjeta en Meta dejan de entregarse.`;
    default:
      return null;
  }
}

/** El nivel ya avisado este mes, para no repetir el mismo aviso: «2026-10:cerca». */
export function claveAviso(mes: string, estado: Estado): string {
  return `${mes}:${estado}`;
}

/** Un estado es más grave que otro (para avisar al subir de nivel, no al bajar). */
const GRAVEDAD: Record<Estado, number> = { bien: 0, cerca: 1, cobra: 2, no_entrega: 3 };
export function hayQueAvisar(estado: Estado, mes: string, yaAvisado: string | null): boolean {
  if (estado === "bien") return false;
  if (!yaAvisado || !yaAvisado.startsWith(`${mes}:`)) return true;
  const previo = yaAvisado.slice(mes.length + 1) as Estado;
  return GRAVEDAD[estado] > (GRAVEDAD[previo] ?? 0);
}

export type ResumenDto = ResumenMes & {
  mes: string;
  config: ConfigContador;
  oficial: CostoOficial | null;
  recibidos: number;
  puedeEditar: boolean;
  plantillasDisponibles: { id: string; name: string; language: string }[];
  ultimoAviso: { clave: string; detalle: string | null; en: string } | null;
};

/** El mes en curso en la zona del negocio: su clave, sus límites en UTC, el día y cuántos días tiene. */
export type Mes = { mes: string; inicio: Date; fin: Date; dia: number; diasMes: number };

export function mesEnZona(ahora: Date, tz: string): Mes {
  const hoy = todayInTz(ahora, tz);
  const [y, m, d] = hoy.split("-").map(Number) as [number, number, number];
  const mes = hoy.slice(0, 7);
  const siguiente = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const inicio = zonedWallClockToUtc(`${mes}-01`, "00:00", tz) ?? new Date(Date.UTC(y, m - 1, 1));
  const fin = zonedWallClockToUtc(siguiente, "00:00", tz) ?? new Date(Date.UTC(y, m, 1));
  return { mes, inicio, fin, dia: d, diasMes: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}
