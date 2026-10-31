import { businessTimezone } from "@/server/analytics/period";
import { resumirMes, type ResumenMes } from "@/lib/contador-mensajes";
import {
  fallosDePago,
  filasDelMes,
  leerConfig,
  mesEnZona,
  type ConfigGuardada,
  type Mes,
} from "./store";

/**
 * Módulo de la agencia — el resumen del mes de una organización: cuántos
 * mensajes salieron, cuántos fueron gratis, cuánto va a cobrar Meta.
 */
export type Calculo = { resumen: ResumenMes; mes: Mes; config: ConfigGuardada; tz: string };

export async function calcularMes(organizationId: string, ahora = new Date()): Promise<Calculo> {
  const tz = await businessTimezone(organizationId);
  const mes = mesEnZona(ahora, tz);
  const [config, filas, fallos] = await Promise.all([
    leerConfig(organizationId),
    filasDelMes(organizationId, mes, tz),
    fallosDePago(organizationId, mes),
  ]);
  const resumen = resumirMes(filas, {
    dia: mes.dia,
    diasMes: mes.diasMes,
    tarifas: config.tarifas,
    alertaPct: config.alertaPct,
    fallosPago: fallos,
  });
  return { resumen, mes, config, tz };
}

/*
 * La franja de aviso vive en el layout y se pinta en CADA pantalla: el cálculo
 * se guarda unos minutos por organización para no recontar el mes en cada clic.
 */
const VIGENCIA_MS = 3 * 60_000;
type Cache = Map<string, { en: number; valor: Calculo }>;
const g = globalThis as unknown as { __voceroContador?: Cache };

export async function calcularMesCacheado(organizationId: string): Promise<Calculo> {
  g.__voceroContador ??= new Map();
  const previo = g.__voceroContador.get(organizationId);
  if (previo && Date.now() - previo.en < VIGENCIA_MS) return previo.valor;
  const valor = await calcularMes(organizationId);
  g.__voceroContador.set(organizationId, { en: Date.now(), valor });
  return valor;
}

/** Después de guardar ajustes, que la franja no siga mostrando lo viejo. */
export function olvidarCache(organizationId: string): void {
  g.__voceroContador?.delete(organizationId);
}
