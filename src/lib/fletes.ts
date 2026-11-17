import { z } from "zod";

/**
 * Módulo de la agencia — Fletes (Ajustes → Ventas → Fletes).
 *
 * Tres cosas, todas internas del negocio (el cliente nunca ve costos ni
 * datos de las transportistas):
 *
 * 1. **Transportistas**: el directorio de empresas de fletes, a mano.
 * 2. **Tabulador**: cuánto cuesta llevar el producto de su origen a cada
 *    estado o ciudad según cuántas piezas van. Por renglón: lo que te cobra
 *    la transportista (costo, interno) y lo que le cobras al cliente (precio).
 *    El renglón puede ser «por viaje» (un precio por todo el rango de piezas)
 *    o «por pieza» (precio × piezas), porque cada transportista cobra distinto.
 * 3. **Envíos**: el seguimiento de cada pedido (vive en Pedidos).
 *
 * Aquí viven las reglas puras (sin base ni red) para poder probarlas.
 */

export const ESTADOS_MX = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
] as const;

/** Cómo lo escribe la gente → el nombre del estado. */
const ALIAS_ESTADO: Record<string, string> = {
  ags: "Aguascalientes",
  bc: "Baja California",
  "b.c.": "Baja California",
  bcs: "Baja California Sur",
  "b.c.s.": "Baja California Sur",
  camp: "Campeche",
  chis: "Chiapas",
  chih: "Chihuahua",
  cdmx: "Ciudad de México",
  df: "Ciudad de México",
  "d.f.": "Ciudad de México",
  "distrito federal": "Ciudad de México",
  "ciudad de mexico": "Ciudad de México",
  coah: "Coahuila",
  "coahuila de zaragoza": "Coahuila",
  col: "Colima",
  dgo: "Durango",
  edomex: "Estado de México",
  "edo mex": "Estado de México",
  "edo. mex.": "Estado de México",
  mex: "Estado de México",
  mexico: "Estado de México",
  gto: "Guanajuato",
  gro: "Guerrero",
  hgo: "Hidalgo",
  jal: "Jalisco",
  mich: "Michoacán",
  mor: "Morelos",
  nay: "Nayarit",
  nl: "Nuevo León",
  "n.l.": "Nuevo León",
  "n. l.": "Nuevo León",
  oax: "Oaxaca",
  pue: "Puebla",
  qro: "Querétaro",
  qroo: "Quintana Roo",
  "q. roo": "Quintana Roo",
  "q.roo": "Quintana Roo",
  slp: "San Luis Potosí",
  "s.l.p.": "San Luis Potosí",
  sin: "Sinaloa",
  son: "Sonora",
  tab: "Tabasco",
  tamps: "Tamaulipas",
  tlax: "Tlaxcala",
  ver: "Veracruz",
  "veracruz de ignacio de la llave": "Veracruz",
  yuc: "Yucatán",
  zac: "Zacatecas",
};

/** Sin acentos, minúsculas y espacios de más. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El nombre del estado a partir de como lo escriban («NL», «nuevo leon»); "" si no se reconoce. */
export function estadoCanonico(texto: string): string {
  const n = normalizar(texto);
  if (!n) return "";
  const directo = ESTADOS_MX.find((e) => normalizar(e) === n);
  if (directo) return directo;
  return ALIAS_ESTADO[n] ?? ALIAS_ESTADO[n.replace(/\s/g, "")] ?? "";
}

const dinero = z.coerce.number().min(0, "No puede ser negativo").max(100_000_000);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const textoCorto = (max: number) => z.string().trim().max(max).default("");

export const transportistaSchema = z.object({
  id: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1, "Escribe el nombre de la transportista").max(80),
  /** Con quién se trata. */
  contacto: textoCorto(80),
  whatsapp: textoCorto(30),
  telefono: textoCorto(30),
  correo: z.union([z.literal(""), z.string().trim().email("Correo no válido").max(120)]).default(""),
  pagina: textoCorto(200),
  /** Qué unidades tiene (plataforma, caja seca, tráiler…). */
  unidades: textoCorto(120),
  /** Cuántas piezas le caben por viaje (null = no se sabe). */
  capacidad: z.coerce.number().int().min(1).max(1000).nullable().default(null),
  /** 0 = sin calificar; 1 a 5 estrellas (puntualidad, cuidado de la carga). */
  calificacion: z.coerce.number().int().min(0).max(5).default(0),
  notas: textoCorto(500),
  activa: z.boolean().default(true),
});
export type Transportista = z.infer<typeof transportistaSchema>;

export const MODOS_TARIFA = ["viaje", "pieza"] as const;
export type ModoTarifa = (typeof MODOS_TARIFA)[number];

export const tarifaSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    /** null = de cualquier transportista (una tarifa general). */
    transportistaId: z.string().trim().max(40).nullable().default(null),
    estado: z.string().trim().min(1, "Elige el estado").max(40),
    /** Vacía = aplica a todo el estado. */
    ciudad: textoCorto(60),
    desde: z.coerce.number().int().min(1).max(1000).default(1),
    hasta: z.coerce.number().int().min(1).max(1000).default(10),
    /** «viaje»: un precio por todo el rango · «pieza»: precio × piezas. */
    modo: z.enum(MODOS_TARIFA).default("viaje"),
    /** Lo que te cobra la transportista. INTERNO: nunca sale al cliente ni al agente. */
    costo: dinero.default(0),
    /** Lo que le cobras al cliente. */
    precio: dinero.default(0),
    /** Tiempo de entrega, en texto («3 a 5 días»). */
    dias: textoCorto(30),
    /** Cuándo se confirmó esta tarifa. */
    actualizada: fecha.nullable().default(null),
    notas: textoCorto(200),
  })
  .refine((t) => t.hasta >= t.desde, { message: "«Hasta» no puede ser menor que «desde»", path: ["hasta"] });
export type Tarifa = z.infer<typeof tarifaSchema>;

export const MAX_TRANSPORTISTAS = 50;
export const MAX_TARIFAS = 500;

export const configFletesSchema = z
  .object({
    /** De dónde sale el producto. */
    origen: z.string().trim().max(80).default("Apodaca, Nuevo León"),
    /** Una tarifa con más días que estos sin actualizar se marca como vieja. */
    diasVigencia: z.coerce.number().int().min(7).max(365).default(60),
    transportistas: z.array(transportistaSchema).max(MAX_TRANSPORTISTAS).default([]),
    tarifas: z.array(tarifaSchema).max(MAX_TARIFAS).default([]),
  })
  .refine((c) => new Set(c.transportistas.map((t) => t.id)).size === c.transportistas.length, {
    message: "Dos transportistas con la misma clave",
    path: ["transportistas"],
  })
  .refine(
    (c) =>
      c.tarifas.every((t) => t.transportistaId === null || c.transportistas.some((x) => x.id === t.transportistaId)),
    { message: "Una tarifa apunta a una transportista que ya no existe", path: ["tarifas"] }
  );
export type ConfigFletes = z.infer<typeof configFletesSchema>;
export const FLETES_POR_DEFECTO: ConfigFletes = configFletesSchema.parse({});

/** ¿Hace cuántos días se actualizó? null si nunca. */
export function diasDesde(actualizada: string | null, hoy: string): number | null {
  if (!actualizada) return null;
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${actualizada}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

export type OpcionFlete = {
  tarifaId: string;
  transportistaId: string | null;
  transportista: string;
  /** Destino de la tarifa, en texto («Monterrey, Nuevo León» o «Todo Jalisco»). */
  destino: string;
  /** La tarifa es de la ciudad exacta (no del estado completo). */
  deCiudad: boolean;
  modo: ModoTarifa;
  piezas: number;
  /** Lo que se le cobra al cliente por el envío completo. */
  precio: number;
  /** Lo que cuesta (interno). */
  costo: number;
  margen: number;
  dias: string;
  /** Sin actualizar en más de `diasVigencia` días (o nunca). */
  vieja: boolean;
};

export function destinoDeTarifa(t: Pick<Tarifa, "estado" | "ciudad">): string {
  return t.ciudad ? `${t.ciudad}, ${t.estado}` : `Todo ${t.estado}`;
}

/**
 * Las tarifas que sirven para llevar `piezas` a ese destino, de la mejor a la
 * peor: primero las de la ciudad exacta (más precisas que las del estado),
 * luego las más baratas para el cliente. Solo transportistas activas.
 */
export function opcionesDeFlete(
  config: ConfigFletes,
  consulta: { estado: string; ciudad?: string; piezas: number },
  hoy: string
): OpcionFlete[] {
  const estado = estadoCanonico(consulta.estado);
  const ciudad = normalizar(consulta.ciudad ?? "");
  const piezas = Math.max(1, Math.round(consulta.piezas));
  if (!estado) return [];
  const porId = new Map(config.transportistas.map((t) => [t.id, t]));
  const opciones: OpcionFlete[] = [];
  for (const t of config.tarifas) {
    if (estadoCanonico(t.estado) !== estado) continue;
    const ciudadTarifa = normalizar(t.ciudad);
    if (ciudadTarifa && ciudadTarifa !== ciudad) continue;
    if (piezas < t.desde || piezas > t.hasta) continue;
    const tr = t.transportistaId ? porId.get(t.transportistaId) : null;
    if (t.transportistaId && (!tr || !tr.activa)) continue;
    if (!(t.precio > 0)) continue;
    const veces = t.modo === "pieza" ? piezas : 1;
    const precio = redondear(t.precio * veces);
    const costo = redondear(t.costo * veces);
    const edad = diasDesde(t.actualizada, hoy);
    opciones.push({
      tarifaId: t.id,
      transportistaId: t.transportistaId,
      transportista: tr?.nombre ?? "Tarifa general",
      destino: destinoDeTarifa(t),
      deCiudad: Boolean(ciudadTarifa),
      modo: t.modo,
      piezas,
      precio,
      costo,
      margen: redondear(precio - costo),
      dias: t.dias,
      vieja: edad === null || edad > config.diasVigencia,
    });
  }
  return opciones.sort((a, b) => Number(b.deCiudad) - Number(a.deCiudad) || a.precio - b.precio);
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** El concepto de la partida de flete en la cotización. */
export function conceptoDeFlete(o: Pick<OpcionFlete, "piezas">, destino: { estado: string; ciudad?: string }, origen: string): string {
  const lugar = [destino.ciudad?.trim(), estadoCanonico(destino.estado) || destino.estado.trim()].filter(Boolean).join(", ");
  const piezas = `${o.piezas} ${o.piezas === 1 ? "pieza" : "piezas"}`;
  return origen.trim() ? `Flete ${origen.trim()} → ${lugar} (${piezas})` : `Flete a ${lugar} (${piezas})`;
}

/** Los destinos que tienen tarifa (para el agente: sin precios ni transportistas). */
export function destinosConTarifa(config: ConfigFletes): string[] {
  const activas = new Set(config.transportistas.filter((t) => t.activa).map((t) => t.id));
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const t of config.tarifas) {
    if (!(t.precio > 0)) continue;
    if (t.transportistaId && !activas.has(t.transportistaId)) continue;
    const d = destinoDeTarifa({ estado: estadoCanonico(t.estado) || t.estado, ciudad: t.ciudad });
    const k = normalizar(d);
    if (vistos.has(k)) continue;
    vistos.add(k);
    lista.push(d);
  }
  return lista.sort((a, b) => a.localeCompare(b, "es"));
}

/* ------------------------------------------------------------ envíos */

export const ESTADOS_ENVIO = ["por_programar", "programado", "en_camino", "entregado", "incidencia"] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

export const ENVIO_INFO: Record<EstadoEnvio, { etiqueta: string; color: string }> = {
  por_programar: { etiqueta: "Por programar", color: "#8b8d98" },
  programado: { etiqueta: "Programado", color: "#0d5bff" },
  en_camino: { etiqueta: "En camino", color: "#b45309" },
  entregado: { etiqueta: "Entregado", color: "#15803d" },
  incidencia: { etiqueta: "Incidencia", color: "#dc2626" },
};

const fechaONula = fecha.nullable().default(null);

export const envioInputSchema = z.object({
  estado: z.enum(ESTADOS_ENVIO).default("por_programar"),
  transportistaId: z.string().trim().max(40).nullable().default(null),
  /** A dónde va («Allende, Nuevo León»). */
  destino: textoCorto(120),
  /** Número de guía o folio de la transportista. */
  guia: textoCorto(60),
  recoleccion: fechaONula,
  entregaEstimada: fechaONula,
  entregadoEl: fechaONula,
  /** Lo que costó el flete (interno). */
  costo: dinero.nullable().default(null),
  /** Lo que se le cobró al cliente por el flete. */
  cobrado: dinero.nullable().default(null),
  notas: textoCorto(500),
});
export type EnvioInput = z.infer<typeof envioInputSchema>;

export type Envio = EnvioInput & {
  /** El nombre de la transportista se copia: si la borran, el envío se sigue leyendo. */
  transportistaNombre: string;
  actualizadoEn: string;
};

/** ¿Ya pasó la entrega estimada y no se ha entregado? */
export function envioAtrasado(e: Pick<Envio, "estado" | "entregaEstimada">, hoy: string): boolean {
  return (
    e.estado !== "entregado" && e.estado !== "por_programar" && Boolean(e.entregaEstimada) && e.entregaEstimada! < hoy
  );
}
