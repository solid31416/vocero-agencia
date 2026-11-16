import { and, eq, isNotNull, lte, ne, or, isNull, sql } from "drizzle-orm";
import { formatoDinero } from "@/lib/cotizaciones";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { folioDe, resumenPagos, textoDeSaldo, tocaRecordarSaldo, type ConfigPedidos } from "@/lib/pedidos";
import { primerNombre } from "@/lib/recordatorios";
import { businessTimezone } from "@/server/analytics/period";
import { publish } from "@/server/events/bus";
import { SendError, sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import { pedidosEnabled } from "./flag";
import { asegurarTablas, hoyIso, leerConfig, pedido, type FilaPedido } from "./store";

/**
 * Módulo de la agencia — recordarle el saldo al cliente. Cada 10 minutos, en
 * el mismo proceso: el día de «Cobrar el saldo el…», a la hora elegida en
 * Ajustes → Pedidos, le escribe al cliente cuánto queda (texto si la ventana
 * de 24 h está abierta; si no, la plantilla). Una vez por fecha de cobro:
 * si el dueño la cambia, vuelve a salir en la nueva. Nunca el Laboratorio.
 */

const INTERVALO_MS = 10 * 60_000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __voceroRecordarSaldo?: Estado };
function estado(): Estado {
  g.__voceroRecordarSaldo ??= { timer: null, corriendo: false };
  return g.__voceroRecordarSaldo;
}

export function iniciarRecordarSaldo(): void {
  if (!pedidosEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaSaldos(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[pedidos] recordatorio de saldo encendido (cada 10 minutos)");
}

function horaEn(zona: string, ahora = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", hourCycle: "h23" }).format(ahora);
  return Number(h) % 24;
}

/** Pedidos con fecha de cobro ya llegada cuyo recordatorio no ha salido para esa fecha. */
function pendientes(organizationId: string | null, hoy: string) {
  return getDb()
    .select()
    .from(pedido)
    .where(
      and(
        organizationId ? eq(pedido.organizationId, organizationId) : undefined,
        eq(pedido.borrado, false),
        isNotNull(pedido.conversationId),
        isNotNull(pedido.cobrarSaldoEl),
        lte(pedido.cobrarSaldoEl, hoy),
        or(isNull(pedido.saldoRecordadoPara), ne(pedido.saldoRecordadoPara, pedido.cobrarSaldoEl))
      )
    )
    .limit(500);
}

/** Una pasada. Exportada para correrla a mano. */
export async function tandaSaldos(ahora = new Date()): Promise<number> {
  const e = estado();
  if (e.corriendo) return 0;
  e.corriendo = true;
  let enviados = 0;
  try {
    await asegurarTablas();
    // Un día de margen hacia adelante: la zona de cada negocio decide su «hoy».
    const manana = new Date(ahora.getTime() + 86_400_000).toISOString().slice(0, 10);
    const orgs = new Set((await pendientes(null, manana)).map((f) => f.organizationId));
    for (const org of orgs) {
      try {
        const config = await leerConfig(org);
        if (!config.recordarSaldo.activo) continue;
        const zona = await businessTimezone(org);
        const hoy = hoyIso(zona);
        const hora = horaEn(zona, ahora);
        for (const f of await pendientes(org, hoy)) {
          const monto = f.monto === null ? null : Number(f.monto);
          const { saldo } = resumenPagos(monto, Array.isArray(f.pagos) ? f.pagos : []);
          if (
            !tocaRecordarSaldo({
              saldo,
              cobrarSaldoEl: f.cobrarSaldoEl,
              recordadoPara: f.saldoRecordadoPara,
              hoy,
              horaLocal: hora,
              hora: config.recordarSaldo.hora,
            })
          ) {
            continue;
          }
          const r = await recordar(org, config, f, { apartar: true });
          if (r.ok) enviados += 1;
        }
      } catch (err) {
        console.error(`[pedidos] recordatorio de saldo ${org}:`, err);
      }
    }
  } catch (err) {
    console.error("[pedidos] la tanda de saldos falló:", err);
  } finally {
    e.corriendo = false;
  }
  return enviados;
}

/**
 * Le manda el recordatorio de saldo al cliente y lo deja anotado en el
 * pedido. `apartar`: solo si nadie lo mandó ya para esa fecha (el revisor).
 */
export async function recordar(
  organizationId: string,
  config: ConfigPedidos,
  f: FilaPedido,
  opciones: { apartar: boolean; hoy?: string }
): Promise<{ ok: boolean; detalle: string }> {
  const db = getDb();
  const para = f.cobrarSaldoEl ?? opciones.hoy ?? hoyIso();
  const monto = f.monto === null ? null : Number(f.monto);
  const { saldo } = resumenPagos(monto, Array.isArray(f.pagos) ? f.pagos : []);
  if (saldo === null || saldo <= 0) return { ok: false, detalle: "Este pedido no tiene saldo pendiente" };
  if (!f.conversationId) return { ok: false, detalle: "El pedido ya no tiene conversación" };

  if (opciones.apartar) {
    const apartado = await db
      .update(pedido)
      .set({ saldoRecordadoPara: para, saldoRecordadoEn: new Date(), saldoRecordadoOk: false, saldoRecordadoDetalle: "Mandando…" })
      .where(
        and(
          eq(pedido.id, f.id),
          eq(pedido.organizationId, organizationId),
          sql`${pedido.saldoRecordadoPara} IS DISTINCT FROM ${para}`
        )
      )
      .returning({ id: pedido.id });
    if (apartado.length === 0) return { ok: false, detalle: "Ya salió" };
  }

  const [conv] = await db
    .select({ isTest: schema.conversation.isTest, channel: schema.conversation.channel })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, f.conversationId)))
    .limit(1);

  const folio = folioDe(f.numero);
  const saldoTexto = formatoDinero(saldo);
  let ok = false;
  let detalle: string;
  if (!conv) detalle = "La conversación ya no existe";
  else if (conv.isTest) detalle = "Conversación de prueba: no se manda";
  else {
    try {
      await sendText({
        organizationId,
        conversationId: f.conversationId,
        text: textoDeSaldo(config.recordarSaldo.texto, {
          contacto: f.contactoNombre,
          saldo: saldoTexto,
          folio,
          concepto: f.concepto,
        }),
      });
      ok = true;
      detalle = "Con texto";
    } catch (err) {
      if (!(err instanceof SendError && err.code === "window_closed")) {
        detalle = `No salió: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
      } else if (!config.recordarSaldo.plantillaId || conv.channel !== "whatsapp") {
        detalle = "Pasaron más de 24 h y no hay plantilla elegida (Ajustes → Pedidos)";
      } else {
        try {
          await sendTemplate({
            organizationId,
            conversationId: f.conversationId,
            templateId: config.recordarSaldo.plantillaId,
            variables: [primerNombre(f.contactoNombre) || "👋", saldoTexto, folio],
          });
          ok = true;
          detalle = "Con plantilla";
        } catch (e2) {
          detalle = `No salió la plantilla: ${e2 instanceof Error ? e2.message : String(e2)}`.slice(0, 300);
        }
      }
    }
  }
  await db
    .update(pedido)
    .set({ saldoRecordadoPara: para, saldoRecordadoEn: new Date(), saldoRecordadoOk: ok, saldoRecordadoDetalle: detalle })
    .where(and(eq(pedido.id, f.id), eq(pedido.organizationId, organizationId)));
  if (ok) publish(organizationId, { type: "conversation.updated", data: { conversation: { id: f.conversationId } } });
  return { ok, detalle };
}
