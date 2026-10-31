import { graphRequest } from "@/lib/meta/client";
import { sumarReporteMeta, type CostoOficial } from "@/lib/contador-mensajes";
import { businessTimezone } from "@/server/analytics/period";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { guardarOficial, leerOficial, mesEnZona } from "./store";

/**
 * Módulo de la agencia — el reporte de costos OFICIAL de Meta
 * (`pricing_analytics` de la cuenta de WhatsApp): cuántos mensajes cobró y
 * cuánto, por día y por tipo. Llega con unas horas de retraso; por eso se
 * guarda en caché y se renueva cada pocas horas. En una cuenta de prueba (sin
 * tarjeta ni moneda) Meta reporta los mensajes con costo 0.
 */

type Punto = { pricing_category?: string; pricing_type?: string; volume?: number; cost?: number };
type Respuesta = {
  currency?: string;
  pricing_analytics?: { data?: { data_points?: Punto[] }[] };
};

const RENOVAR_CADA_MS = 3 * 60 * 60_000;
/** Meta solo deja pedir el último año. */
const MAX_ATRAS_S = 364 * 24 * 3600;

export async function actualizarOficial(
  organizationId: string,
  ahora = new Date(),
  forzar = false
): Promise<CostoOficial | null> {
  const tz = await businessTimezone(organizationId);
  const mes = mesEnZona(ahora, tz);
  const guardado = await leerOficial(organizationId, mes.mes);
  if (!forzar && guardado && ahora.getTime() - Date.parse(guardado.actualizadoEn) < RENOVAR_CADA_MS) {
    return guardado;
  }

  const cred = await getCredentialsByOrg(organizationId);
  if (!cred || cred.status !== "connected") return guardado;

  const ahoraS = Math.floor(ahora.getTime() / 1000);
  const inicio = Math.max(Math.floor(mes.inicio.getTime() / 1000), ahoraS - MAX_ATRAS_S);
  const fin = Math.floor(mes.fin.getTime() / 1000);
  const campos =
    `currency,pricing_analytics.start(${inicio}).end(${fin}).granularity(DAILY)` +
    `.dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;
  try {
    const r = await graphRequest<Respuesta>(`${cred.wabaId}?fields=${encodeURIComponent(campos)}`, {
      token: cred.token,
    });
    const puntos = (r.pricing_analytics?.data ?? []).flatMap((d) => d.data_points ?? []);
    const suma = sumarReporteMeta(puntos);
    const oficial = { mes: mes.mes, moneda: r.currency ?? null, ...suma };
    await guardarOficial(organizationId, oficial);
    return { ...oficial, actualizadoEn: ahora.toISOString() };
  } catch (err) {
    console.warn("[contador] no se pudo leer el reporte de costos de Meta:", err instanceof Error ? err.message : err);
    return guardado;
  }
}
