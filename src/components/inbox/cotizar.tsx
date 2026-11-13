"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_PARTIDAS,
  calcularTotales,
  formatoDinero,
  type CotizacionDto,
  type Partida,
  type Producto,
} from "@/lib/cotizaciones";
import { EstadoChip } from "@/components/settings/cotizaciones-client";

/**
 * Módulo de la agencia (Treviño AI) — «Cotizar» en el encabezado del hilo.
 *
 * Arma la cotización (productos de la lista o conceptos libres, cantidades,
 * descuento y notas), la deja ver en PDF y la manda por WhatsApp como
 * documento. «Que la IA la llene» lee la plática y propone productos y
 * cantidades; los precios salen de la lista, nunca de la IA.
 *
 * Solo se dibuja con la bandera COTIZACIONES (decidido en el servidor).
 */

type Condiciones = {
  ivaPct: number;
  preciosConIva: boolean;
  anticipoPct: number;
  vigenciaDias: number;
  moneda: "MXN" | "USD";
};

type Datos = { cotizaciones: CotizacionDto[]; productos: Producto[]; condiciones: Condiciones };

const partidaVacia = (): Partida => ({
  productoId: null,
  concepto: "",
  descripcion: "",
  cantidad: 1,
  unidad: "pieza",
  precio: 0,
});

export function Cotizar({ conversation, onDone }: { conversation: ConversationDto; onDone: () => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Hacer una cotización para este cliente"
        title="Hacer una cotización para este cliente"
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium leading-5 text-text-2 transition-colors",
          "hover:border-text-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        <span className="max-sm:sr-only">Cotizar</span>
      </button>
      {abierto && (
        <VentanaCotizar
          conversation={conversation}
          onCancel={() => setAbierto(false)}
          onDone={() => {
            setAbierto(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

function VentanaCotizar({
  conversation,
  onCancel,
  onDone,
}: {
  conversation: ConversationDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [partidas, setPartidas] = useState<Partida[]>([partidaVacia()]);
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [notas, setNotas] = useState("");
  const [borradorId, setBorradorId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "ia" | "vista" | "enviar">(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/cotizaciones?conversationId=${encodeURIComponent(conversation.id)}`).catch(
        () => null
      );
      if (!res?.ok) return setAviso({ ok: false, texto: "No se pudieron cargar las cotizaciones" });
      const d = (await res.json()) as Datos;
      setDatos(d);
      // Si quedó un borrador de esta conversación, se retoma.
      const borrador = d.cotizaciones.find((c) => c.estado === "borrador");
      if (borrador) {
        setBorradorId(borrador.id);
        setPartidas(borrador.partidas);
        setDescuentoPct(borrador.descuentoPct);
        setNotas(borrador.notas);
      }
    })();
  }, [conversation.id]);

  const totales = useMemo(
    () =>
      datos
        ? calcularTotales(partidas, {
            descuentoPct,
            ivaPct: datos.condiciones.ivaPct,
            preciosConIva: datos.condiciones.preciosConIva,
            anticipoPct: datos.condiciones.anticipoPct,
          })
        : null,
    [datos, partidas, descuentoPct]
  );
  const moneda = datos?.condiciones.moneda ?? "MXN";
  const sinPrecio = partidas.some((p) => p.concepto.trim() && p.precio <= 0);
  const completas = partidas.filter((p) => p.concepto.trim());

  const cambiarPartida = (i: number, parcial: Partial<Partida>) =>
    setPartidas((ps) => ps.map((p, j) => (j === i ? { ...p, ...parcial } : p)));

  function elegirProducto(i: number, productoId: string) {
    if (!productoId) return cambiarPartida(i, { productoId: null });
    const p = datos?.productos.find((x) => x.id === productoId);
    if (p) {
      cambiarPartida(i, {
        productoId: p.id,
        concepto: p.nombre,
        descripcion: p.descripcion,
        unidad: p.unidad,
        precio: p.precio,
      });
    }
  }

  async function llenarConIa() {
    setOcupado("ia");
    setAviso(null);
    const res = await fetch("/api/cotizaciones/sugerir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id }),
    }).catch(() => null);
    setOcupado(null);
    const d = (await res?.json().catch(() => null)) as
      | { partidas?: Partida[]; sinPrecio?: number; notas?: string; error?: { message?: string } }
      | null;
    if (!res?.ok || !d?.partidas) {
      return setAviso({ ok: false, texto: d?.error?.message ?? "La IA no pudo llenarla" });
    }
    setPartidas(d.partidas);
    if (d.notas && !notas.trim()) setNotas(d.notas);
    setAviso(
      d.sinPrecio
        ? { ok: false, texto: `La IA puso ${d.sinPrecio} concepto(s) que no están en tu lista: llena su precio.` }
        : { ok: true, texto: "Lista. Revisa cantidades antes de enviar." }
    );
  }

  /** Guarda (o actualiza) el borrador y devuelve su id. */
  async function guardarBorrador(): Promise<string | null> {
    const res = await fetch("/api/cotizaciones", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: borradorId,
        conversationId: conversation.id,
        partidas: completas,
        descuentoPct,
        notas,
      }),
    }).catch(() => null);
    const d = (await res?.json().catch(() => null)) as
      | { cotizacion?: CotizacionDto; error?: { message?: string } }
      | null;
    if (!res?.ok || !d?.cotizacion) {
      setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar la cotización" });
      return null;
    }
    setBorradorId(d.cotizacion.id);
    return d.cotizacion.id;
  }

  async function vistaPrevia() {
    // La pestaña se abre YA (dentro del clic) para que el navegador no la bloquee.
    const ventana = window.open("about:blank", "_blank");
    setOcupado("vista");
    setAviso(null);
    const id = await guardarBorrador();
    setOcupado(null);
    if (!id) return ventana?.close();
    if (ventana) ventana.location.href = `/api/cotizaciones/${id}/pdf`;
    else window.location.href = `/api/cotizaciones/${id}/pdf`;
  }

  async function enviar() {
    setOcupado("enviar");
    setAviso(null);
    const id = await guardarBorrador();
    if (!id) return setOcupado(null);
    const res = await fetch(`/api/cotizaciones/${id}/enviar`, { method: "POST" }).catch(() => null);
    setOcupado(null);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo enviar la cotización" });
    }
    onDone();
  }

  const anteriores = (datos?.cotizaciones ?? []).filter((c) => c.estado !== "borrador");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cotizar-titulo"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-lg border bg-popover p-5 shadow-pop"
        data-cotizar
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="cotizar-titulo" className="text-[16px] font-bold">
              Cotización para {conversation.contact.name}
            </h3>
            <p className="mt-1 text-sm text-text-3">
              Los precios salen de tu lista (Ajustes → Cotizaciones). Puedes cambiarlos aquí.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void llenarConIa()} disabled={!datos || ocupado !== null}>
            <Sparkles className="mr-1 h-4 w-4" aria-hidden />
            {ocupado === "ia" ? "Leyendo la plática…" : "Que la IA la llene"}
          </Button>
        </div>

        {!datos ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <>
            {datos.productos.length === 0 && (
              <p className="rounded-md bg-subtle p-2 text-xs text-text-3">
                Aún no tienes lista de productos. Puedes escribir conceptos libres, o cargar tu lista en{" "}
                <a href="/settings/cotizaciones" className="underline">
                  Ajustes → Cotizaciones
                </a>
                .
              </p>
            )}

            <ul className="space-y-2">
              {partidas.map((p, i) => (
                <li key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_5rem_7rem_auto]">
                  <div className="space-y-1.5">
                    {datos.productos.length > 0 && (
                      <select
                        aria-label="Producto de la lista"
                        value={p.productoId ?? ""}
                        onChange={(e) => elegirProducto(i, e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">— Concepto libre —</option>
                        {datos.productos.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nombre} · {formatoDinero(x.precio, moneda)}
                          </option>
                        ))}
                      </select>
                    )}
                    <Input
                      aria-label="Concepto"
                      placeholder="Concepto"
                      value={p.concepto}
                      onChange={(e) => cambiarPartida(i, { concepto: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-text-3">Cantidad</Label>
                    <Input
                      aria-label="Cantidad"
                      type="number"
                      min={1}
                      step="any"
                      value={p.cantidad}
                      onChange={(e) => cambiarPartida(i, { cantidad: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-text-3">Precio unitario</Label>
                    <Input
                      aria-label="Precio unitario"
                      type="number"
                      min={0}
                      step="0.01"
                      value={p.precio}
                      className={cn(p.concepto.trim() && p.precio <= 0 && "border-danger-text")}
                      onChange={(e) => cambiarPartida(i, { precio: Number(e.target.value) })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    aria-label="Quitar partida"
                    disabled={partidas.length === 1}
                    onClick={() => setPartidas((ps) => ps.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {partidas.length < MAX_PARTIDAS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setPartidas((ps) => [...ps, partidaVacia()])}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden /> Agregar partida
              </Button>
            )}

            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="cot-descuento">Descuento (%)</Label>
                <Input
                  id="cot-descuento"
                  type="number"
                  min={0}
                  max={100}
                  value={descuentoPct}
                  onChange={(e) => setDescuentoPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cot-notas">Notas (salen en el PDF)</Label>
                <Textarea
                  id="cot-notas"
                  rows={2}
                  maxLength={1000}
                  value={notas}
                  placeholder="Ubicación de entrega, tiempos, detalles del proyecto…"
                  onChange={(e) => setNotas(e.target.value)}
                />
              </div>
            </div>

            {totales && (
              <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-text-3">Subtotal</dt>
                <dd className="text-right">{formatoDinero(totales.subtotal, moneda)}</dd>
                {totales.descuento > 0 && (
                  <>
                    <dt className="text-text-3">Descuento</dt>
                    <dd className="text-right">-{formatoDinero(totales.descuento, moneda)}</dd>
                  </>
                )}
                {datos.condiciones.ivaPct > 0 && (
                  <>
                    <dt className="text-text-3">
                      IVA {datos.condiciones.preciosConIva ? "incluido " : ""}({datos.condiciones.ivaPct}%)
                    </dt>
                    <dd className="text-right">{formatoDinero(totales.iva, moneda)}</dd>
                  </>
                )}
                <dt className="font-bold">Total</dt>
                <dd className="text-right font-bold">{formatoDinero(totales.total, moneda)}</dd>
                {datos.condiciones.anticipoPct > 0 && datos.condiciones.anticipoPct < 100 && (
                  <>
                    <dt className="text-text-3">Anticipo ({datos.condiciones.anticipoPct}%)</dt>
                    <dd className="text-right">{formatoDinero(totales.anticipo, moneda)}</dd>
                  </>
                )}
              </dl>
            )}

            {!conversation.windowOpen && (
              <p className="rounded-md bg-warning-tint p-2 text-xs text-warning-text">
                El cliente no te ha escrito en las últimas 24 h: WhatsApp no deja mandarle el PDF todavía. Puedes
                guardarla y verla; envíala cuando te vuelva a escribir.
              </p>
            )}
            {aviso && (
              <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                {aviso.texto}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cerrar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={completas.length === 0 || ocupado !== null}
                onClick={() => void vistaPrevia()}
              >
                {ocupado === "vista" ? "Armando…" : "Ver PDF"}
              </Button>
              <Button
                type="button"
                disabled={completas.length === 0 || sinPrecio || !conversation.windowOpen || ocupado !== null}
                title={sinPrecio ? "Hay partidas sin precio" : undefined}
                onClick={() => void enviar()}
              >
                {ocupado === "enviar" ? "Enviando…" : "Enviar por WhatsApp"}
              </Button>
            </div>

            {anteriores.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                <Label className="text-[12px]">Cotizaciones anteriores de este cliente</Label>
                <ul className="divide-y text-sm">
                  {anteriores.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                      <EstadoChip estado={c.estado} />
                      <a
                        href={`/api/cotizaciones/${c.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-semibold hover:underline"
                      >
                        {c.folio}
                      </a>
                      <span className="text-text-3">{formatoDinero(c.totales.total, c.moneda)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
