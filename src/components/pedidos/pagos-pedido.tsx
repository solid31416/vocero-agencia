"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirmar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumeroInput } from "@/components/ui/numero-input";
import { Textarea } from "@/components/ui/textarea";
import { formatoDinero } from "@/lib/cotizaciones";
import { MAX_MENSAJE, NOMBRE_PAGO, fechaLegible, mensajeDePago, resumenPagos, type PedidoDto } from "@/lib/pedidos";

/**
 * Módulo de la agencia (Treviño AI) — anticipo y saldo de un pedido: cuánto
 * se ha pagado y cuánto falta, los pagos recibidos, registrar uno nuevo
 * (con aviso al cliente si se quiere) y cuándo toca cobrar el saldo.
 */

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PagosPedido({
  pedido,
  puedeBorrar,
  onCambio,
}: {
  pedido: PedidoDto;
  puedeBorrar: boolean;
  onCambio: (p: PedidoDto) => void;
}) {
  const pagos = pedido.pagos ?? [];
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(0);
  const [fecha, setFecha] = useState(hoyLocal());
  const [nota, setNota] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [cobrar, setCobrar] = useState(pedido.cobrarSaldoEl ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // Módulo de la agencia: el anticipo de la cotización de la que salió el
  // pedido, para registrarlo con un toque; y cuándo cobrar el saldo.
  const [anticipoCot, setAnticipoCot] = useState<number | null>(null);
  const [cobrarAlRegistrar, setCobrarAlRegistrar] = useState(pedido.cobrarSaldoEl ?? "");
  const esPrimero = pagos.length === 0;
  useEffect(() => {
    if (!abierto || !esPrimero || !pedido.cotizacionId) return;
    let vivo = true;
    void fetch(`/api/cotizaciones/${pedido.cotizacionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cotizacion?: { totales?: { anticipo?: number } } } | null) => {
        const a = d?.cotizacion?.totales?.anticipo ?? 0;
        if (vivo && a > 0) {
          setAnticipoCot(a);
          setMonto((m) => (m > 0 ? m : a));
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [abierto, esPrimero, pedido.cotizacionId]);

  const tras = resumenPagos(pedido.monto, [...pagos, { monto }]);
  const textoBase = mensajeDePago({
    contacto: pedido.contactoNombre,
    folio: pedido.folio,
    monto: formatoDinero(monto || 0),
    saldo: tras.saldo !== null && tras.saldo > 0 ? formatoDinero(tras.saldo) : null,
    liquidado: tras.liquidado,
  });
  const texto = mensaje ?? textoBase;
  const quedaSaldo = tras.saldo !== null && tras.saldo > 0;
  const avance = pedido.monto && pedido.monto > 0 ? Math.min(100, (pedido.pagado / pedido.monto) * 100) : 0;

  async function registrar() {
    if (!(monto > 0)) return setAviso({ ok: false, texto: "Escribe cuánto pagó" });
    setOcupado(true);
    setAviso(null);
    const res = await fetch(`/api/pedidos/${pedido.id}/pagos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        monto,
        fecha: fecha || null,
        nota,
        avisar,
        ...(avisar ? { mensaje: texto } : {}),
        ...(quedaSaldo && cobrarAlRegistrar !== (pedido.cobrarSaldoEl ?? "")
          ? { cobrarSaldoEl: cobrarAlRegistrar || null }
          : {}),
      }),
    }).catch(() => null);
    setOcupado(false);
    const d = (await res?.json().catch(() => null)) as {
      pedido?: PedidoDto;
      etapaEmbudo?: string | null;
      aviso?: { aviso: string; detalle: string | null } | null;
      error?: { message?: string };
    } | null;
    if (!res?.ok || !d?.pedido) return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo registrar el pago" });
    const partes = [`Pago de ${formatoDinero(monto)} registrado.`];
    if (quedaSaldo && cobrarAlRegistrar) partes.push(`Te recordamos cobrar el saldo el ${fechaLegible(cobrarAlRegistrar)}.`);
    setCobrar(d.pedido.cobrarSaldoEl ?? "");
    if (d.etapaEmbudo) partes.push(`El cliente pasó a «${d.etapaEmbudo}».`);
    const fallo = d.aviso && d.aviso.aviso !== "texto" && d.aviso.aviso !== "plantilla";
    if (avisar && fallo) partes.push(`No se le avisó: ${d.aviso?.detalle ?? "sin detalle"}.`);
    setAviso({ ok: !(avisar && fallo), texto: partes.join(" ") });
    setMonto(0);
    setNota("");
    setMensaje(null);
    setAbierto(false);
    onCambio(d.pedido);
  }

  async function quitar(pagoId: string) {
    if (!(await confirmar("¿Quitar este pago? Úsalo solo si se capturó por error.", { accion: "Sí, quitar pago" }))) return;
    const res = await fetch(`/api/pedidos/${pedido.id}/pagos?pagoId=${encodeURIComponent(pagoId)}`, {
      method: "DELETE",
    }).catch(() => null);
    const d = (await res?.json().catch(() => null)) as { pedido?: PedidoDto } | null;
    if (!res?.ok || !d?.pedido) return setAviso({ ok: false, texto: "No se pudo quitar el pago" });
    setAviso(null);
    onCambio(d.pedido);
  }

  async function recordarAhora() {
    setOcupado(true);
    setAviso(null);
    const res = await fetch(`/api/pedidos/${pedido.id}/recordar-saldo`, { method: "POST" }).catch(() => null);
    setOcupado(false);
    const d = (await res?.json().catch(() => null)) as {
      detalle?: string;
      pedido?: PedidoDto | null;
      error?: { message?: string };
    } | null;
    if (!res?.ok) return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo mandar el recordatorio" });
    setAviso({ ok: true, texto: `Recordatorio de saldo enviado (${(d?.detalle ?? "").toLowerCase()}).` });
    if (d?.pedido) onCambio(d.pedido);
  }

  async function guardarCobro() {
    setOcupado(true);
    const res = await fetch(`/api/pedidos/${pedido.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cobrarSaldoEl: cobrar || null }),
    }).catch(() => null);
    setOcupado(false);
    const d = (await res?.json().catch(() => null)) as { pedido?: PedidoDto } | null;
    if (!res?.ok || !d?.pedido) return setAviso({ ok: false, texto: "No se pudo guardar la fecha de cobro" });
    setAviso({ ok: true, texto: cobrar ? `Te lo recordamos el ${fechaLegible(cobrar)}.` : "Fecha de cobro quitada." });
    onCambio(d.pedido);
  }

  return (
    <div className="space-y-2 rounded-md border p-2.5" data-pagos={pedido.folio}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Wallet className="h-4 w-4 text-text-3" aria-hidden /> Pagos
        </p>
        {pedido.liquidado ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-text">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Liquidado
          </span>
        ) : pedido.tocaCobrar ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-text">
            <AlertCircle className="h-3 w-3" aria-hidden /> Toca cobrar el saldo
          </span>
        ) : null}
      </div>

      {pedido.monto !== null ? (
        <>
          <p className="text-sm">
            Pagado <strong>{formatoDinero(pedido.pagado)}</strong> de {formatoDinero(pedido.monto)}
            {pedido.saldo !== null && pedido.saldo > 0 && (
              <>
                {" · "}Falta <strong>{formatoDinero(pedido.saldo)}</strong>
              </>
            )}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${avance}%` }} />
          </div>
        </>
      ) : (
        <p className="text-xs text-text-3">
          Pagado {formatoDinero(pedido.pagado)}. Ponle monto al pedido para saber cuánto falta.
        </p>
      )}

      {pagos.length > 0 && (
        <ul className="divide-y text-sm">
          {pagos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-1">
              <span className="w-20 text-xs font-medium text-text-2">{NOMBRE_PAGO[p.tipo]}</span>
              <span className="font-medium">{formatoDinero(p.monto)}</span>
              <span className="text-xs text-text-3">{fechaLegible(p.fecha)}</span>
              {p.nota && <span className="text-xs text-text-3">· {p.nota}</span>}
              {puedeBorrar && (
                <button
                  type="button"
                  aria-label="Quitar pago"
                  className="ml-auto text-text-3 hover:text-danger-text"
                  onClick={() => void quitar(p.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {abierto ? (
        <div className="space-y-2 rounded-md bg-subtle p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`pago-monto-${pedido.id}`}>
                {pagos.length === 0 ? "Anticipo recibido" : "Pago recibido"}
              </Label>
              <NumeroInput
                id={`pago-monto-${pedido.id}`}
                min={0}
                step="any"
                value={monto}
                onValueChange={(n) => {
                  setMonto(Number.isFinite(n) ? n : 0);
                  setMensaje(null);
                }}
              />
              {esPrimero && anticipoCot !== null && anticipoCot !== monto && (
                <button
                  type="button"
                  className="block text-xs text-brand-text hover:underline"
                  onClick={() => {
                    setMonto(anticipoCot);
                    setMensaje(null);
                  }}
                >
                  Anticipo de la cotización ({formatoDinero(anticipoCot)})
                </button>
              )}
              {esPrimero && anticipoCot !== null && anticipoCot === monto && (
                <p className="text-xs text-text-3">Es el anticipo de la cotización.</p>
              )}
              {pedido.saldo !== null && pedido.saldo > 0 && (
                <button
                  type="button"
                  className="block text-xs text-brand-text hover:underline"
                  onClick={() => {
                    setMonto(pedido.saldo ?? 0);
                    setMensaje(null);
                  }}
                >
                  Liquida el total que falta ({formatoDinero(pedido.saldo)})
                </button>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`pago-fecha-${pedido.id}`}>Fecha</Label>
              <Input id={`pago-fecha-${pedido.id}`} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          {quedaSaldo && (
            <div className="space-y-1">
              <Label htmlFor={`pago-cobrar-${pedido.id}`}>
                ¿Cuándo le cobramos el saldo de {formatoDinero(tras.saldo ?? 0)}?
              </Label>
              <Input
                id={`pago-cobrar-${pedido.id}`}
                type="date"
                value={cobrarAlRegistrar}
                onChange={(e) => setCobrarAlRegistrar(e.target.value)}
                className="w-auto"
              />
              <p className="text-xs text-text-3">Ese día te avisamos y se le recuerda al cliente. Puedes dejarlo vacío.</p>
            </div>
          )}
          <Input
            value={nota}
            maxLength={200}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Nota (opcional): transferencia, efectivo, referencia…"
            aria-label="Nota del pago"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
            Avisarle al cliente que recibimos su pago
          </label>
          {avisar && (
            <Textarea
              rows={2}
              maxLength={MAX_MENSAJE}
              value={texto}
              onChange={(e) => setMensaje(e.target.value)}
              aria-label="Mensaje del pago para el cliente"
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void registrar()} disabled={ocupado || !(monto > 0)}>
              {ocupado ? "Guardando…" : "Registrar pago"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAbierto(false)} disabled={ocupado}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        !pedido.liquidado && (
          <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
            {pagos.length === 0 ? "Registrar anticipo" : "Registrar pago"}
          </Button>
        )
      )}

      {!pedido.liquidado && pedido.saldo !== null && pedido.saldo > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <Label htmlFor={`cobrar-${pedido.id}`} className="text-xs font-normal text-text-2">
            Cobrar el saldo el
          </Label>
          <Input
            id={`cobrar-${pedido.id}`}
            type="date"
            value={cobrar}
            onChange={(e) => setCobrar(e.target.value)}
            className="h-8 w-auto"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado || (cobrar || null) === pedido.cobrarSaldoEl}
            onClick={() => void guardarCobro()}
          >
            Guardar
          </Button>
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => void recordarAhora()}>
            Recordárselo ahora
          </Button>
          {pedido.saldoRecordado && (
            <p className={cn("w-full text-xs", pedido.saldoRecordado.ok ? "text-text-3" : "text-warning-text")}>
              {pedido.saldoRecordado.ok ? "Se le recordó el saldo" : "No salió el recordatorio de saldo"} el{" "}
              {new Date(pedido.saldoRecordado.en).toLocaleString("es-MX", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              {pedido.saldoRecordado.detalle ? ` · ${pedido.saldoRecordado.detalle}` : ""}
            </p>
          )}
        </div>
      )}

      {aviso && (
        <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
