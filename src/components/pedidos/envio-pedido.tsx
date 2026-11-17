"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatoDinero } from "@/lib/cotizaciones";
import { ENVIO_INFO, ESTADOS_ENVIO, type EnvioInput, type Transportista } from "@/lib/fletes";
import { fechaLegible, type PedidoDto } from "@/lib/pedidos";

/**
 * Módulo de la agencia — Fletes: el envío de un pedido (transportista, guía,
 * fechas, lo que costó contra lo que se cobró). Es interno: al cliente se le
 * avisa con las etapas del pedido.
 */

const claseSelect = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

const VACIO: EnvioInput = {
  estado: "por_programar",
  transportistaId: null,
  destino: "",
  guia: "",
  recoleccion: null,
  entregaEstimada: null,
  entregadoEl: null,
  costo: null,
  cobrado: null,
  notas: "",
};

function numeroONulo(texto: string): number | null {
  if (!texto.trim()) return null;
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function EnvioPedido({ pedido, onCambio }: { pedido: PedidoDto; onCambio: (p: PedidoDto) => void }) {
  const e = pedido.envio;
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<EnvioInput>(e ?? VACIO);
  const [transportistas, setTransportistas] = useState<Transportista[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setForm(e ?? VACIO);
    void fetch("/api/settings/fletes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { fletes?: { transportistas?: Transportista[] } } | null) => {
        if (vivo) setTransportistas(d?.fletes?.transportistas ?? []);
      })
      .catch(() => vivo && setTransportistas([]));
    // Sin envío todavía: el flete que se cobró y el destino salen de la cotización.
    if (!e && pedido.cotizacionId) {
      void fetch(`/api/cotizaciones/${pedido.cotizacionId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { cotizacion?: { partidas?: { concepto: string; cantidad: number; precio: number }[] } } | null) => {
          const fletes = (d?.cotizacion?.partidas ?? []).filter((p) => /flete/i.test(p.concepto));
          if (!vivo || fletes.length === 0) return;
          const cobrado = fletes.reduce((s, p) => s + p.cantidad * p.precio, 0);
          const destino = /→\s*([^(]+)/.exec(fletes[0]!.concepto)?.[1]?.trim() ?? "";
          setForm((f) => ({ ...f, cobrado: f.cobrado ?? cobrado, destino: f.destino || destino }));
        })
        .catch(() => {});
    }
    return () => {
      vivo = false;
    };
  }, [abierto, e, pedido.cotizacionId]);

  const cambiar = (p: Partial<EnvioInput>) => {
    setForm((f) => ({ ...f, ...p }));
    setAviso(null);
  };

  async function guardar() {
    setOcupado(true);
    const res = await fetch(`/api/pedidos/${pedido.id}/envio`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setOcupado(false);
    const d = (await res?.json().catch(() => null)) as { pedido?: PedidoDto; error?: { message?: string } } | null;
    if (!res?.ok || !d?.pedido) return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    onCambio(d.pedido);
    setAbierto(false);
  }

  async function quitar() {
    if (!window.confirm("¿Quitar el envío de este pedido?")) return;
    const res = await fetch(`/api/pedidos/${pedido.id}/envio`, { method: "DELETE" }).catch(() => null);
    const d = (await res?.json().catch(() => null)) as { pedido?: PedidoDto } | null;
    if (res?.ok && d?.pedido) {
      onCambio(d.pedido);
      setAbierto(false);
    } else setAviso({ ok: false, texto: "No se pudo quitar" });
  }

  const info = e ? ENVIO_INFO[e.estado] : null;

  return (
    <div className="space-y-2 rounded-md border p-2.5" data-envio-pedido>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Truck className="h-4 w-4" aria-hidden /> Envío
          {info && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: info.color }}>
              {info.etiqueta}
            </span>
          )}
          {pedido.envioAtrasado && <span className="text-xs font-medium text-danger-text">⚠ atrasado</span>}
        </p>
        {!abierto && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(true)} data-envio-editar>
            {e ? "Actualizar" : "Capturar envío"}
          </Button>
        )}
      </div>
      {e && !abierto && (
        <p className="text-xs text-text-3">
          {[
            e.destino && `→ ${e.destino}`,
            e.transportistaNombre,
            e.guia && `Guía ${e.guia}`,
            e.recoleccion && `Recolección ${fechaLegible(e.recoleccion)}`,
            e.estado === "entregado" && e.entregadoEl
              ? `Entregado ${fechaLegible(e.entregadoEl)}`
              : e.entregaEstimada && `Llega ${fechaLegible(e.entregaEstimada)}`,
            e.costo !== null && `Costó ${formatoDinero(e.costo)}`,
            e.cobrado !== null && `Cobrado ${formatoDinero(e.cobrado)}`,
          ]
            .filter(Boolean)
            .join(" · ") || "Sin datos todavía"}
        </p>
      )}

      {abierto && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Estado del envío</Label>
              <select
                aria-label="Estado del envío"
                className={claseSelect}
                value={form.estado}
                onChange={(ev) => cambiar({ estado: ev.target.value as EnvioInput["estado"] })}
              >
                {ESTADOS_ENVIO.map((s) => (
                  <option key={s} value={s}>
                    {ENVIO_INFO[s].etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Transportista</Label>
              <select
                aria-label="Transportista del envío"
                className={claseSelect}
                value={form.transportistaId ?? ""}
                onChange={(ev) => cambiar({ transportistaId: ev.target.value || null })}
              >
                <option value="">— Sin elegir —</option>
                {(transportistas ?? [])
                  .filter((t) => t.activa || t.id === form.transportistaId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                {form.transportistaId &&
                  transportistas &&
                  !transportistas.some((t) => t.id === form.transportistaId) && (
                    <option value={form.transportistaId}>{e?.transportistaNombre || "(ya no está en Fletes)"}</option>
                  )}
              </select>
              {transportistas?.length === 0 && (
                <p className="text-[11px] text-text-3">
                  Da de alta tus transportistas en{" "}
                  <a href="/settings/fletes" className="underline">
                    Ventas → Fletes
                  </a>
                  .
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Destino</Label>
              <Input aria-label="Destino" value={form.destino} maxLength={120} placeholder="Ciudad, estado" onChange={(ev) => cambiar({ destino: ev.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Guía o folio de la transportista</Label>
              <Input aria-label="Guía" value={form.guia} maxLength={60} onChange={(ev) => cambiar({ guia: ev.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Recolección</Label>
              <Input type="date" aria-label="Recolección" value={form.recoleccion ?? ""} onChange={(ev) => cambiar({ recoleccion: ev.target.value || null })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">{form.estado === "entregado" ? "Entregado el" : "Entrega estimada"}</Label>
              {form.estado === "entregado" ? (
                <Input type="date" aria-label="Entregado el" value={form.entregadoEl ?? ""} onChange={(ev) => cambiar({ entregadoEl: ev.target.value || null })} />
              ) : (
                <Input type="date" aria-label="Entrega estimada" value={form.entregaEstimada ?? ""} onChange={(ev) => cambiar({ entregaEstimada: ev.target.value || null })} />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Lo que costó (interno)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                aria-label="Costo del flete"
                value={form.costo ?? ""}
                onChange={(ev) => cambiar({ costo: numeroONulo(ev.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-3">Lo que se le cobró al cliente</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                aria-label="Flete cobrado"
                value={form.cobrado ?? ""}
                onChange={(ev) => cambiar({ cobrado: numeroONulo(ev.target.value) })}
              />
            </div>
          </div>
          {form.costo !== null && form.cobrado !== null && (
            <p className={cn("text-xs", form.cobrado - form.costo < 0 ? "text-danger-text" : "text-text-3")}>
              Margen del flete: {formatoDinero(form.cobrado - form.costo)}
            </p>
          )}
          <Textarea
            aria-label="Notas del envío"
            rows={2}
            maxLength={500}
            value={form.notas}
            placeholder="Incidencias, contacto del chofer, condiciones de entrega…"
            onChange={(ev) => cambiar({ notas: ev.target.value })}
          />
          <p className="text-[11px] text-text-3">
            Esto es interno. Para avisarle al cliente, mueve el pedido de etapa («En camino», «Entregado»).
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {aviso && <p className={cn("mr-auto text-xs", aviso.ok ? "text-success-text" : "text-danger-text")}>{aviso.texto}</p>}
            {e && (
              <Button type="button" variant="ghost" size="sm" onClick={quitar}>
                Quitar envío
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={guardar} disabled={ocupado} data-envio-guardar>
              {ocupado ? "Guardando…" : "Guardar envío"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
