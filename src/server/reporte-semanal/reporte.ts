import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { resumenPagos, tocaCobrar } from "@/lib/pedidos";
import {
  CONFIG_POR_DEFECTO,
  configSchema,
  textoDelReporte,
  tocaReporte,
  variablesDelReporte,
  type ConfigReporte,
  type ReporteDto,
} from "@/lib/reporte-semanal";
import { addDaysISO, todayInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import { porModeloBlock } from "@/server/analytics/por-modelo";
import { businessTimezone } from "@/server/analytics/period";
import { getBranding } from "@/server/branding";
import { avisarAlDueno } from "@/server/contador-mensajes/worker";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import {
  asegurarTablas as tablasCotizaciones,
  cotizacion,
  leerConfig as leerConfigCot,
} from "@/server/cotizaciones/store";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { asegurarTablas as tablasPedidos, pedido } from "@/server/pedidos/store";

/**
 * Módulo de la agencia — el reporte semanal al dueño: la configuración, el
 * cálculo (los 7 días anteriores al día de envío, en la zona del negocio) y
 * el revisor que lo manda (cada 10 minutos, en el proceso). Va con la bandera
 * COTIZACIONES: es el resumen de ventas de ese módulo y del de pedidos.
 */

export const reporteConfig = pgTable("agencia_reporte_config", {
  organizationId: text("organization_id").primaryKey(),
  config: jsonb("config").$type<ConfigReporte>().notNull(),
  /** Fecha local del último que salió (o se intentó) por el revisor. */
  ultimoPara: text("ultimo_para"),
  ultimoEn: timestamp("ultimo_en"),
  ultimoDetalle: text("ultimo_detalle"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

let listas: Promise<void> | null = null;
function asegurarTablas(): Promise<void> {
  listas ??= getDb()
    .execute(
      sql`CREATE TABLE IF NOT EXISTS agencia_reporte_config (
        organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        config jsonb NOT NULL,
        ultimo_para text,
        ultimo_en timestamp,
        ultimo_detalle text,
        updated_at timestamp NOT NULL DEFAULT now()
      )`
    )
    .then(() => undefined)
    .catch((err) => {
      listas = null;
      throw err;
    });
  return listas;
}

export type EstadoReporte = {
  config: ConfigReporte;
  ultimo: { para: string; en: string; detalle: string | null } | null;
};

export async function leerReporte(organizationId: string): Promise<EstadoReporte> {
  await asegurarTablas();
  const [f] = await getDb()
    .select()
    .from(reporteConfig)
    .where(scoped(reporteConfig.organizationId, organizationId))
    .limit(1);
  if (!f) return { config: CONFIG_POR_DEFECTO, ultimo: null };
  const r = configSchema.safeParse(f.config);
  return {
    config: r.success ? r.data : CONFIG_POR_DEFECTO,
    ultimo:
      f.ultimoPara && f.ultimoEn ? { para: f.ultimoPara, en: f.ultimoEn.toISOString(), detalle: f.ultimoDetalle } : null,
  };
}

export async function guardarReporte(organizationId: string, config: ConfigReporte): Promise<ConfigReporte> {
  await asegurarTablas();
  await getDb()
    .insert(reporteConfig)
    .values({ organizationId, config, updatedAt: new Date() })
    .onConflictDoUpdate({ target: reporteConfig.organizationId, set: { config, updatedAt: new Date() } });
  return config;
}

/* ------------------------------------------------------------------ cálculo */

/** El reporte de los 7 días anteriores a `hoy` (fecha local del negocio). */
export async function calcularReporte(organizationId: string, ahora = new Date()): Promise<ReporteDto> {
  const zona = await businessTimezone(organizationId);
  const hoy = todayInTz(ahora, zona);
  const desde = addDaysISO(hoy, -7);
  const hasta = addDaysISO(hoy, -1);
  const start = zonedWallClockToUtc(desde, "00:00", zona) ?? new Date(ahora.getTime() - 7 * 86_400_000);
  const end = zonedWallClockToUtc(hoy, "00:00", zona) ?? ahora;
  const db = getDb();
  const branding = await getBranding(organizationId);

  // Clientes nuevos: conversaciones reales que empezaron en la semana.
  const [nuevos] = await db
    .select({ n: sql<number>`count(distinct ${schema.conversation.contactId})` })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.isTest, false),
        gte(schema.conversation.createdAt, start),
        lt(schema.conversation.createdAt, end)
      )
    );

  const r: ReporteDto = {
    desde,
    hasta,
    negocio: branding.name,
    moneda: "MXN",
    nuevos: Number(nuevos?.n ?? 0),
    modelos: [],
    cotizaciones: null,
    cerradas: null,
    cobrado: null,
    porCobrar: null,
    sinRespuesta: null,
    url: process.env.APP_BASE_URL?.replace(/\/+$/, "") ?? null,
  };

  if (cotizacionesEnabled()) {
    await tablasCotizaciones();
    const cfg = await leerConfigCot(organizationId);
    r.moneda = cfg.moneda;
    try {
      const pm = await porModeloBlock(organizationId, { start, end });
      r.modelos = pm.filas
        .filter((f) => f.interesados > 0)
        .slice(0, 3)
        .map((f) => ({ nombre: f.nombre, interesados: f.interesados }));
    } catch (err) {
      console.warn("[reporte] no se pudo calcular por modelo:", err);
    }
    const cots = await db
      .select({
        estado: cotizacion.estado,
        totales: cotizacion.totales,
        enviadaEn: cotizacion.enviadaEn,
        updatedAt: cotizacion.updatedAt,
        venceEn: cotizacion.venceEn,
        lastInboundAt: schema.conversation.lastInboundAt,
      })
      .from(cotizacion)
      .innerJoin(schema.conversation, eq(schema.conversation.id, cotizacion.conversationId))
      .where(
        and(
          eq(cotizacion.organizationId, organizationId),
          eq(schema.conversation.isTest, false),
          inArray(cotizacion.estado, ["enviada", "aceptada", "rechazada", "vencida"])
        )
      );
    const enRango = (d: Date | null) => d !== null && d >= start && d < end;
    const enviadas = cots.filter((c) => enRango(c.enviadaEn));
    const cerradas = cots.filter((c) => c.estado === "aceptada" && enRango(c.updatedAt));
    r.cotizaciones = { n: enviadas.length, monto: enviadas.reduce((s, c) => s + (c.totales?.total ?? 0), 0) };
    r.cerradas = { n: cerradas.length, monto: cerradas.reduce((s, c) => s + (c.totales?.total ?? 0), 0) };
    r.sinRespuesta = cots.filter(
      (c) =>
        c.estado === "enviada" &&
        c.enviadaEn !== null &&
        (!c.venceEn || c.venceEn > ahora) &&
        (!c.lastInboundAt || c.lastInboundAt <= c.enviadaEn)
    ).length;
  }

  if (pedidosEnabled()) {
    await tablasPedidos();
    const peds = await db
      .select({ monto: pedido.monto, pagos: pedido.pagos, cobrarSaldoEl: pedido.cobrarSaldoEl })
      .from(pedido)
      .where(and(eq(pedido.organizationId, organizationId), eq(pedido.borrado, false)));
    let cobrado = 0;
    let porCobrar = 0;
    let tocan = 0;
    for (const p of peds) {
      const pagos = Array.isArray(p.pagos) ? p.pagos : [];
      for (const pg of pagos) if (pg.fecha >= desde && pg.fecha <= hasta) cobrado += pg.monto;
      const monto = p.monto === null ? null : Number(p.monto);
      const { saldo } = resumenPagos(monto, pagos);
      if (saldo !== null && saldo > 0 && pagos.length > 0) {
        porCobrar += saldo;
        if (tocaCobrar(saldo, p.cobrarSaldoEl ?? null, hoy)) tocan += 1;
      }
    }
    r.cobrado = Math.round(cobrado * 100) / 100;
    r.porCobrar = { monto: Math.round(porCobrar * 100) / 100, tocan };
  }
  return r;
}

/** Lo manda al dueño. Devuelve qué pasó, en palabras. */
export async function mandarReporte(
  organizationId: string,
  config: ConfigReporte,
  ahora = new Date()
): Promise<{ ok: boolean; detalle: string; texto: string }> {
  const r = await calcularReporte(organizationId, ahora);
  const texto = textoDelReporte(r);
  const detalle = await avisarAlDueno(
    organizationId,
    { telefonoDueno: config.telefonoDueno, plantillaId: config.plantillaId },
    texto,
    "",
    (cuantas) => variablesDelReporte(r, cuantas)
  );
  return { ok: detalle.startsWith("Enviado"), detalle, texto };
}

/* ------------------------------------------------------------------ revisor */

const INTERVALO_MS = 10 * 60_000;
type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __voceroReporte?: Estado };
function estado(): Estado {
  g.__voceroReporte ??= { timer: null, corriendo: false };
  return g.__voceroReporte;
}

export function iniciarReporteSemanal(): void {
  if (!cotizacionesEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaReporte(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[reporte] reporte semanal encendido (revisa cada 10 minutos)");
}

const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function relojLocal(zona: string, ahora: Date): { hoy: string; diaSemana: number; hora: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const dia = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0") % 24;
  return { hoy: todayInTz(ahora, zona), diaSemana: Math.max(0, DIAS_EN.indexOf(dia)), hora };
}

export async function tandaReporte(ahora = new Date()): Promise<number> {
  const e = estado();
  if (e.corriendo) return 0;
  e.corriendo = true;
  let enviados = 0;
  try {
    await asegurarTablas();
    const filas = await getDb().select().from(reporteConfig);
    for (const f of filas) {
      try {
        const c = configSchema.safeParse(f.config);
        if (!c.success || !c.data.activo) continue;
        const zona = await businessTimezone(f.organizationId);
        const reloj = relojLocal(zona, ahora);
        if (
          !tocaReporte({
            config: c.data,
            hoy: reloj.hoy,
            diaSemana: reloj.diaSemana,
            horaLocal: reloj.hora,
            ultimoPara: f.ultimoPara,
          })
        ) {
          continue;
        }
        // Se aparta primero: si dos procesos coinciden, solo uno lo manda.
        const apartado = await getDb()
          .update(reporteConfig)
          .set({ ultimoPara: reloj.hoy, ultimoEn: new Date(), ultimoDetalle: "Mandando…" })
          .where(
            and(
              eq(reporteConfig.organizationId, f.organizationId),
              sql`${reporteConfig.ultimoPara} IS DISTINCT FROM ${reloj.hoy}`
            )
          )
          .returning({ id: reporteConfig.organizationId });
        if (apartado.length === 0) continue;
        const r = await mandarReporte(f.organizationId, c.data, ahora);
        await getDb()
          .update(reporteConfig)
          .set({ ultimoDetalle: r.detalle, ultimoEn: new Date() })
          .where(eq(reporteConfig.organizationId, f.organizationId));
        if (r.ok) enviados += 1;
        console.log(`[reporte] ${f.organizationId}: ${r.detalle}`);
      } catch (err) {
        console.error(`[reporte] ${f.organizationId}:`, err);
      }
    }
  } catch (err) {
    console.error("[reporte] la tanda falló:", err);
  } finally {
    e.corriendo = false;
  }
  return enviados;
}
