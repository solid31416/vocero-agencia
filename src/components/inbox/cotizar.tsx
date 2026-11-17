"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Bot, Copy, FileText, PartyPopper, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_CLIENTE,
  MAX_PARTIDAS,
  calcularTotales,
  formatoDinero,
  sePuedeAceptar,
  type CotizacionDto,
  type SeguimientoCotDto,
  type Partida,
  type Producto,
} from "@/lib/cotizaciones";
import { EstadoChip } from "@/components/settings/cotizaciones-client";
import { AceptarCotizacion } from "@/components/cotizaciones/aceptar-cotizacion";
import { FleteCotizador } from "@/components/cotizaciones/flete-cotizador";

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

type Datos = {
  cotizaciones: CotizacionDto[];
  productos: Producto[];
  condiciones: Condiciones;
  /** Módulo de pedidos encendido: «Marcar aceptada» crea el pedido. */
  pedidosActivos?: boolean;
  /** Cotización → folio del pedido que ya nació de ella. */
  pedidoDeCotizacion?: Record<string, string>;
  /** El nombre (y la empresa) que dio el cliente en la plática, si lo dio. */
  aNombreDe?: string | null;
  /** Cómo va el seguimiento de cada cotización enviada. */
  seguimientos?: Record<string, SeguimientoCotDto>;
};

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
  // ¿El cliente parece haber dicho que sí a una cotización? Se revisa al
  // abrir la conversación y cada vez que llega un mensaje.
  const [senal, setSenal] = useState<CotizacionDto | null>(null);
  // Módulo de la agencia (vendedor): el agente dejó una lista para revisar.
  const [porAprobar, setPorAprobar] = useState<CotizacionDto | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const res = await fetch(`/api/cotizaciones?conversationId=${encodeURIComponent(conversation.id)}`).catch(
        () => null
      );
      if (!vivo || !res?.ok) return;
      const d = (await res.json().catch(() => null)) as { cotizaciones?: CotizacionDto[] } | null;
      if (!vivo) return;
      setSenal(d?.cotizaciones?.find((c) => c.senal && sePuedeAceptar(c.estado)) ?? null);
      setPorAprobar(d?.cotizaciones?.find((c) => c.estado === "borrador" && c.deAgente) ?? null);
    })();
    return () => {
      vivo = false;
    };
  }, [conversation.id, conversation.lastMessageAt, revision]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={
          porAprobar
            ? `El agente preparó la cotización ${porAprobar.folio}: revísala`
            : senal
              ? `El cliente parece aceptar la cotización ${senal.folio}`
              : "Hacer una cotización para este cliente"
        }
        title={
          porAprobar
            ? `El agente preparó la cotización ${porAprobar.folio}: revísala`
            : senal
              ? `El cliente parece aceptar la cotización ${senal.folio}`
              : "Hacer una cotización para este cliente"
        }
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          porAprobar
            ? "border-brand/40 bg-brand-tint text-brand-text"
            : senal
              ? "border-success-text/40 bg-success-tint text-success-text"
              : "border-border-strong text-text-2 hover:border-text-3 hover:text-foreground"
        )}
        data-senal={senal ? senal.folio : undefined}
        data-por-aprobar={porAprobar ? porAprobar.folio : undefined}
      >
        {porAprobar ? (
          <Bot className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        ) : senal ? (
          <PartyPopper className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        ) : (
          <FileText className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        )}
        <span>{porAprobar ? "Revisar cotización" : senal ? "¿Aceptó?" : "Cotizar"}</span>
      </button>
      {abierto && (
        <VentanaCotizar
          conversation={conversation}
          onCancel={() => {
            setAbierto(false);
            setRevision((n) => n + 1);
          }}
          onDone={() => {
            setAbierto(false);
            setRevision((n) => n + 1);
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
  // A nombre de quién sale. Arranca con el del contacto (el de su WhatsApp,
  // salvo que alguien lo haya renombrado); la IA lo cambia por el que dio en
  // la plática solo si nadie lo ha tocado.
  const [cliente, setCliente] = useState(conversation.contact.name);
  const nombreInicial = useRef(conversation.contact.name);
  const [borradorId, setBorradorId] = useState<string | null>(null);
  // Módulo de la agencia (vendedor): el borrador lo armó el agente, o esta
  // corrige a una que ya se mandó.
  const [deAgente, setDeAgente] = useState(false);
  const [corrige, setCorrige] = useState<{ id: string; folio: string } | null>(null);
  // Si el cliente ya tiene cotizaciones (y no hay borrador), primero se ven
  // ellas con sus datos; el formulario en blanco es solo para hacer otra.
  const [armando, setArmando] = useState(true);
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
      setArmando(Boolean(borrador) || !d.cotizaciones.some((c) => c.estado !== "borrador"));
      // Sin borrador, la cotización arranca a nombre de lo que dijo el cliente.
      if (!borrador && d.aNombreDe) setCliente((c) => (c === nombreInicial.current ? d.aNombreDe! : c));
      if (borrador) {
        setBorradorId(borrador.id);
        setPartidas(borrador.partidas);
        setDescuentoPct(borrador.descuentoPct);
        setNotas(borrador.notas);
        setCliente(borrador.contactoNombre);
        setDeAgente(borrador.deAgente);
        const previa = borrador.reemplazaA ? d.cotizaciones.find((c) => c.id === borrador.reemplazaA) : null;
        setCorrige(previa ? { id: previa.id, folio: previa.folio } : null);
      }
    })();
  }, [conversation.id]);

  /** Relee la lista (tras aceptar una) sin tocar el borrador que se está armando. */
  async function recargarLista() {
    const res = await fetch(`/api/cotizaciones?conversationId=${encodeURIComponent(conversation.id)}`).catch(
      () => null
    );
    if (res?.ok) setDatos((await res.json()) as Datos);
  }

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
      | { partidas?: Partida[]; sinPrecio?: number; notas?: string; cliente?: string; error?: { message?: string } }
      | null;
    if (!res?.ok || !d?.partidas) {
      return setAviso({ ok: false, texto: d?.error?.message ?? "La IA no pudo llenarla" });
    }
    setPartidas(d.partidas);
    if (d.notas && !notas.trim()) setNotas(d.notas);
    if (d.cliente && (!cliente.trim() || cliente === conversation.contact.name)) setCliente(d.cliente);
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
        cliente: cliente.trim(),
        reemplazaA: corrige?.id ?? null,
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

  /**
   * Arma una nueva a partir de una que ya se mandó (mismas partidas, notas y
   * nombre). Con `corregir`, la nueva la reemplaza: al mandarla, la anterior
   * queda «Corregida» y el cliente recibe el aviso.
   */
  function copiar(c: CotizacionDto, corregir = false) {
    setPartidas(c.partidas.map((p) => ({ ...p })));
    setDescuentoPct(c.descuentoPct);
    setNotas(c.notas);
    setCliente(c.contactoNombre);
    setBorradorId(null);
    setDeAgente(false);
    setCorrige(corregir ? { id: c.id, folio: c.folio } : null);
    setAviso(null);
    setArmando(true);
  }

  function nueva() {
    setPartidas([partidaVacia()]);
    setDescuentoPct(0);
    setNotas("");
    setCliente(datos?.aNombreDe || conversation.contact.name);
    setBorradorId(null);
    setDeAgente(false);
    setCorrige(null);
    setAviso(null);
    setArmando(true);
  }

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
              {armando
                ? `${borradorId ? "Cotización" : "Nueva cotización"} para ${cliente.trim() || conversation.contact.name}`
                : `Cotizaciones de ${conversation.contact.name}`}
            </h3>
            <p className="mt-1 text-sm text-text-3">
              {armando
                ? "Los precios salen de tu lista (Ajustes → Cotizaciones). Puedes cambiarlos aquí."
                : "Lo que ya le mandaste. Márcala aceptada cuando te diga que sí, o haz otra."}
            </p>
            {armando && deAgente && (
              <p className="mt-2 rounded-md bg-brand-tint px-2.5 py-1.5 text-sm text-brand-text" data-de-agente>
                🤖 La preparó el agente con los precios de tu lista. Revísala y dale «Enviar por WhatsApp».
              </p>
            )}
            {armando && corrige && (
              <p className="mt-2 rounded-md bg-warning-tint px-2.5 py-1.5 text-sm text-warning-text" data-corrige>
                Corrige a la {corrige.folio}: al enviarla, esa queda como «Corregida» y el cliente recibe la nueva
                con el aviso.
              </p>
            )}
          </div>
          {armando && (
            <Button type="button" variant="outline" size="sm" onClick={() => void llenarConIa()} disabled={!datos || ocupado !== null}>
              <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              {ocupado === "ia" ? "Leyendo la plática…" : "Que la IA la llene"}
            </Button>
          )}
        </div>

        {!datos ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !armando ? (
          <>
            <ul className="space-y-3">
              {anteriores.map((c) => (
                <TarjetaCotizacion
                  key={c.id}
                  cotizacion={c}
                  pedidosActivos={Boolean(datos.pedidosActivos)}
                  pedidoFolio={datos.pedidoDeCotizacion?.[c.id] ?? null}
                  seguimiento={datos.seguimientos?.[c.id] ?? null}
                  onCopiar={() => copiar(c)}
                  onCorregir={() => copiar(c, true)}
                  onListo={(texto, ok) => {
                    setAviso({ ok, texto });
                    void recargarLista();
                  }}
                />
              ))}
            </ul>
            {aviso && (
              <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                {aviso.texto}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cerrar
              </Button>
              <Button type="button" onClick={nueva}>
                <Plus className="mr-1 h-4 w-4" aria-hidden /> Nueva cotización
              </Button>
            </div>
          </>
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
                    <NumeroInput
                      aria-label="Cantidad"
                      min={1}
                      step="any"
                      value={p.cantidad}
                      onValueChange={(n) => cambiarPartida(i, { cantidad: n })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-text-3">Precio unitario</Label>
                    <NumeroInput
                      aria-label="Precio unitario"
                      min={0}
                      step="0.01"
                      value={p.precio}
                      className={cn(p.concepto.trim() && p.precio <= 0 && "border-danger-text")}
                      onValueChange={(n) => cambiarPartida(i, { precio: n })}
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
            {partidas.length < MAX_PARTIDAS && (
              <FleteCotizador
                partidas={partidas}
                productos={datos.productos}
                moneda={moneda}
                onAgregar={(nueva) =>
                  setPartidas((ps) => [...ps.filter((p) => p.concepto.trim() || p.precio > 0), nueva])
                }
              />
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cot-cliente">A nombre de (sale en el PDF y en el mensaje)</Label>
              <Input
                id="cot-cliente"
                maxLength={MAX_CLIENTE}
                value={cliente}
                placeholder="Nombre del cliente o de su empresa"
                onChange={(e) => setCliente(e.target.value)}
              />
              {cliente.trim() === conversation.contact.name && (
                <p className="text-[11px] text-text-3">
                  Sale del nombre que dio el cliente (o del de su WhatsApp si todavía no lo da). Cámbialo si hace falta, o deja que la IA lo llene.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="cot-descuento">Descuento (%)</Label>
                <NumeroInput
                  id="cot-descuento"
                  min={0}
                  max={100}
                  value={descuentoPct}
                  onValueChange={(n) => setDescuentoPct(Math.min(100, Math.max(0, n)))}
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
              {anteriores.length > 0 && (
                <Button type="button" variant="ghost" className="mr-auto" onClick={() => setArmando(false)}>
                  ← Ver las que ya mandé
                </Button>
              )}
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
                      <span className="ml-auto">
                        <AceptarCotizacion
                          cotizacion={c}
                          pedidosActivos={Boolean(datos?.pedidosActivos)}
                          pedidoFolio={datos?.pedidoDeCotizacion?.[c.id] ?? null}
                          onListo={(texto, ok) => {
                            setAviso({ ok, texto });
                            void recargarLista();
                          }}
                        />
                      </span>
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

/** Una cotización ya mandada, con lo que dice: partidas, total, notas y qué sigue. */
function TarjetaCotizacion({
  cotizacion: c,
  pedidosActivos,
  pedidoFolio,
  seguimiento,
  onCopiar,
  onCorregir,
  onListo,
}: {
  cotizacion: CotizacionDto;
  pedidosActivos: boolean;
  pedidoFolio: string | null;
  seguimiento: SeguimientoCotDto | null;
  onCopiar: () => void;
  onCorregir: () => void;
  onListo: (texto: string, ok: boolean) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  async function accion(a: "pausar" | "reanudar" | "ahora" | "descartar_senal") {
    setOcupado(true);
    const res = await fetch(`/api/cotizaciones/${c.id}/seguimiento`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accion: a }),
    }).catch(() => null);
    setOcupado(false);
    const d = (await res?.json().catch(() => null)) as { detalle?: string; error?: { message?: string } } | null;
    if (!res?.ok) return onListo(d?.error?.message ?? "No se pudo", false);
    const textos = {
      pausar: `Seguimiento de ${c.folio} detenido.`,
      reanudar: `Seguimiento de ${c.folio} reanudado.`,
      ahora: d?.detalle ?? "Recordatorio enviado.",
      descartar_senal: "Listo: lo ignoramos.",
    } as const;
    onListo(textos[a], true);
  }
  const fecha = new Date(c.enviadaEn ?? c.createdAt).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <li className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <EstadoChip estado={c.estado} />
        <span className="font-mono font-semibold">{c.folio}</span>
        <span className="text-xs text-text-3">{fecha}</span>
        <span className="ml-auto font-bold">{formatoDinero(c.totales.total, c.moneda)}</span>
      </div>
      <p className="text-xs text-text-3">
        A nombre de {c.contactoNombre}
        {c.automatica ? " · 🤖 la mandó el agente" : c.deAgente ? " · 🤖 la preparó el agente" : ""}
      </p>
      <ul className="space-y-0.5">
        {c.partidas.map((p, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              {p.cantidad} × {p.concepto}
            </span>
            <span className="shrink-0 text-text-3">{formatoDinero(p.cantidad * p.precio, c.moneda)}</span>
          </li>
        ))}
      </ul>
      {(c.descuentoPct > 0 || c.totales.anticipo > 0) && (
        <p className="text-xs text-text-3">
          {c.descuentoPct > 0 && `Descuento ${c.descuentoPct}%. `}
          {c.totales.anticipo > 0 && c.totales.anticipo < c.totales.total
            ? `Anticipo ${formatoDinero(c.totales.anticipo, c.moneda)}.`
            : ""}
        </p>
      )}
      {c.notas && <p className="text-xs text-text-2">Notas: {c.notas}</p>}
      {c.senal && sePuedeAceptar(c.estado) && (
        <div className="space-y-1 rounded-md border border-success-text/30 bg-success-tint p-2 text-xs" data-senal-cot={c.folio}>
          <p className="flex items-center gap-1.5 font-semibold text-success-text">
            <PartyPopper className="h-3.5 w-3.5" aria-hidden /> Parece que el cliente dijo que sí
          </p>
          <p className="text-text-2">«{c.senal.texto}»</p>
          <p className="flex flex-wrap items-center gap-2 text-text-3">
            Si es así, usa «Marcar aceptada» aquí abajo.
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void accion("descartar_senal")}
              className="font-medium text-text-2 underline underline-offset-2 hover:text-foreground"
            >
              No era eso
            </button>
          </p>
        </div>
      )}
      {seguimiento && <LineaSeguimiento c={c} s={seguimiento} ocupado={ocupado} onAccion={(a) => void accion(a)} />}
      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <a
          href={`/api/cotizaciones/${c.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden /> Ver PDF
        </a>
        <button
          type="button"
          onClick={onCopiar}
          className="inline-flex items-center gap-1 text-xs font-medium text-text-2 hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden /> Hacer otra a partir de esta
        </button>
        {(c.estado === "enviada" || c.estado === "vencida") && (
          <button
            type="button"
            onClick={onCorregir}
            className="inline-flex items-center gap-1 text-xs font-medium text-warning-text hover:underline"
            data-corregir={c.folio}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Corregir
          </button>
        )}
        <span className="ml-auto">
          <AceptarCotizacion
            cotizacion={c}
            pedidosActivos={pedidosActivos}
            pedidoFolio={pedidoFolio}
            onListo={onListo}
          />
        </span>
      </div>
    </li>
  );
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

const NOMBRE_TOQUE = { texto: "con texto", plantilla: "con plantilla" } as const;

/** Seguimiento sin respuesta: qué salió, qué sigue, y detenerlo o mandarlo ya. */
function LineaSeguimiento({
  c,
  s,
  ocupado,
  onAccion,
}: {
  c: CotizacionDto;
  s: SeguimientoCotDto;
  ocupado: boolean;
  onAccion: (a: "pausar" | "reanudar" | "ahora") => void;
}) {
  const enviada = c.estado === "enviada" || c.estado === "vencida";
  return (
    <div className="space-y-1 rounded-md bg-subtle p-2 text-xs" data-seguimiento-cot={c.folio}>
      <p className="flex items-center gap-1.5 font-medium text-text-2">
        <BellRing className="h-3.5 w-3.5" aria-hidden /> Seguimiento
      </p>
      {s.toques.map((t, i) => (
        <p key={i} className={t.estado === "enviado" ? "text-text-2" : "text-warning-text"}>
          {t.estado === "enviado" ? "Recordatorio enviado" : "No salió el recordatorio"} {NOMBRE_TOQUE[t.toque]} el{" "}
          {fechaHora(t.en)}
          {t.estado !== "enviado" && t.detalle ? `: ${t.detalle}` : ""}
        </p>
      ))}
      {s.siguiente ? (
        <p className="text-text-2">
          Siguiente recordatorio {NOMBRE_TOQUE[s.siguiente.toque]}: {fechaHora(s.siguiente.fecha)}
        </p>
      ) : s.motivo ? (
        <p className="text-text-3">{s.motivo}</p>
      ) : enviada && s.toques.length > 0 ? (
        <p className="text-text-3">Ya salieron los recordatorios.</p>
      ) : null}
      {c.estado === "enviada" && (
        <div className="flex flex-wrap gap-3 pt-0.5">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => onAccion("ahora")}
            className="font-medium text-brand-text hover:underline"
          >
            Mandar recordatorio ahora
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => onAccion(c.seguimientoPausado ? "reanudar" : "pausar")}
            className="font-medium text-text-2 hover:text-foreground"
          >
            {c.seguimientoPausado ? "Reanudar seguimiento" : "Detener seguimiento"}
          </button>
        </div>
      )}
    </div>
  );
}
