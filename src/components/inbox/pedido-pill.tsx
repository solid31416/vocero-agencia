"use client";

import { useCallback, useEffect, useState } from "react";
import { Package, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CotizacionDto } from "@/lib/cotizaciones";
import type { Etapa, PedidoDto } from "@/lib/pedidos";
import { PedidoTarjeta } from "@/components/pedidos/pedido-tarjeta";

/**
 * Módulo de la agencia (Treviño AI) — «Pedido» en el encabezado del hilo:
 * los pedidos de este cliente, moverlos de etapa avisándole, y crear uno
 * nuevo (a mano o desde una cotización aceptada).
 *
 * Solo se dibuja con la bandera PEDIDOS (decidido en el servidor).
 */

type Datos = { pedidos: PedidoDto[]; etapas: Etapa[] };

/** Resumen de las partidas de una cotización para el concepto del pedido. */
function conceptoDe(c: CotizacionDto): string {
  return c.partidas
    .map((p) => (p.cantidad === 1 ? p.concepto : `${p.cantidad} × ${p.concepto}`))
    .join(", ")
    .slice(0, 300);
}

export function PedidoPill({ conversation, puedeBorrar }: { conversation: ConversationDto; puedeBorrar: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/pedidos?conversationId=${encodeURIComponent(conversation.id)}`).catch(() => null);
    if (!res?.ok) return setDatos(null);
    setDatos((await res.json()) as Datos);
  }, [conversation.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ultimo = datos?.pedidos[0] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={ultimo ? `Pedido ${ultimo.folio}: ${ultimo.etapaNombre}` : "Pedidos de este cliente"}
        title={ultimo ? `Pedido ${ultimo.folio}: ${ultimo.etapaNombre}` : "Pedidos de este cliente"}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ultimo
            ? "border-brand-text/40 bg-brand-tint text-brand-text"
            : "border-border-strong text-text-2 hover:border-text-3 hover:text-foreground"
        )}
      >
        <Package className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        <span className="max-w-[9rem] truncate max-sm:sr-only">{ultimo ? ultimo.etapaNombre : "Pedido"}</span>
      </button>
      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pedidos del cliente"
          onClick={(e) => e.target === e.currentTarget && setAbierto(false)}
        >
          <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <Package className="h-4 w-4 text-primary" aria-hidden /> Pedidos
                </h3>
                <p className="text-sm text-muted-foreground">{conversation.contact.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded-md px-2 py-1 text-sm text-text-2 hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            {!datos ? (
              <p className="text-sm text-text-3">Cargando…</p>
            ) : (
              <>
                {datos.pedidos.map((p) => (
                  <PedidoTarjeta
                    key={p.id}
                    pedido={p}
                    etapas={datos.etapas}
                    puedeBorrar={puedeBorrar}
                    onCambio={() => void cargar()}
                  />
                ))}
                <NuevoPedido conversation={conversation} hayOtros={datos.pedidos.length > 0} onCreado={() => void cargar()} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function NuevoPedido({
  conversation,
  hayOtros,
  onCreado,
}: {
  conversation: ConversationDto;
  hayOtros: boolean;
  onCreado: () => void;
}) {
  const [abierto, setAbierto] = useState(!hayOtros);
  const [aceptadas, setAceptadas] = useState<CotizacionDto[]>([]);
  const [cotizacionId, setCotizacionId] = useState<string | null>(null);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el módulo de cotizaciones está encendido, ofrece las aceptadas.
  useEffect(() => {
    if (!abierto) return;
    void (async () => {
      const res = await fetch(`/api/cotizaciones?conversationId=${encodeURIComponent(conversation.id)}`).catch(
        () => null
      );
      if (!res?.ok) return;
      const d = (await res.json()) as { cotizaciones: CotizacionDto[] };
      setAceptadas(d.cotizaciones.filter((c) => c.estado === "aceptada"));
    })();
  }, [abierto, conversation.id]);

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <Plus className="mr-1 h-4 w-4" /> Nuevo pedido
      </Button>
    );
  }

  async function crear() {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/pedidos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: conversation.id,
        concepto,
        monto: monto.trim() ? Number(monto) : null,
        fechaEstimada: fecha || null,
        cotizacionId,
        avisar,
      }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(d?.error?.message ?? "No se pudo crear el pedido");
    }
    setConcepto("");
    setMonto("");
    setFecha("");
    setCotizacionId(null);
    setAbierto(false);
    onCreado();
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Nuevo pedido</p>
      {aceptadas.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="pedido-cotizacion">Desde una cotización aceptada</Label>
          <select
            id="pedido-cotizacion"
            value={cotizacionId ?? ""}
            onChange={(e) => {
              const c = aceptadas.find((x) => x.id === e.target.value) ?? null;
              setCotizacionId(c?.id ?? null);
              if (c) {
                setConcepto(conceptoDe(c));
                setMonto(String(c.totales.total));
              }
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">— Escribirlo a mano —</option>
            {aceptadas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.folio} · ${c.totales.total.toLocaleString("es-MX")}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="pedido-concepto">¿Qué se pidió?</Label>
        <Input
          id="pedido-concepto"
          value={concepto}
          maxLength={300}
          onChange={(e) => setConcepto(e.target.value)}
          placeholder="Ej. 2 × Domo Estándar con instalación"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pedido-monto">Monto (opcional)</Label>
          <Input
            id="pedido-monto"
            type="number"
            min={0}
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pedido-fecha">Entrega estimada</Label>
          <Input id="pedido-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
        Avisarle que su pedido quedó confirmado
      </label>
      {error && <p className="text-sm text-danger-text">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void crear()} disabled={ocupado || !concepto.trim()}>
          {ocupado ? "Creando…" : "Crear pedido"}
        </Button>
        {hayOtros && (
          <Button size="sm" variant="outline" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
