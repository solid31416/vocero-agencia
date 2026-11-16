"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ESTADO_INFO, formatoDinero, productoPrincipal, type CotizacionDto } from "@/lib/cotizaciones";
import { pedirAceptar, textoDeAceptada } from "@/components/cotizaciones/aceptar-cotizacion";
import { EstadoChip } from "@/components/settings/cotizaciones-client";

/**
 * Módulo de la agencia (Treviño AI) — la pantalla «Cotizaciones» del menú:
 * todas las que salieron, contadas por estado, con buscador. Desde aquí se
 * marcan aceptadas o rechazadas sin entrar a Ajustes; los productos, precios
 * y condiciones siguen en Ajustes → Cotizaciones.
 */

type Datos = { cotizaciones: CotizacionDto[]; pedidoDeCotizacion: Record<string, string> };

/** «senal» = el cliente parece haber dicho que sí y nadie la ha marcado. */
type Filtro = CotizacionDto["estado"] | "senal";

const ORDEN: CotizacionDto["estado"][] = ["enviada", "aceptada", "rechazada", "vencida", "borrador"];

const abierta = (c: CotizacionDto) => c.estado === "enviada" || c.estado === "vencida";
const conSenal = (c: CotizacionDto) => Boolean(c.senal) && abierta(c);

export function CotizacionesLista() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState(false);
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [q, setQ] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/cotizaciones?limite=200").catch(() => null);
    if (!res?.ok) return setError(true);
    setDatos((await res.json()) as Datos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    if (!datos) return [];
    const texto = q.trim().toLowerCase();
    return datos.cotizaciones.filter((c) => {
      if (filtro === "senal" ? !conSenal(c) : filtro && c.estado !== filtro) return false;
      if (!texto) return true;
      const conceptos = c.partidas.map((p) => p.concepto).join(" ");
      return `${c.folio} ${c.contactoNombre} ${conceptos}`.toLowerCase().includes(texto);
    });
  }, [datos, filtro, q]);

  /** Aceptada: con el módulo de pedidos también nace su pedido (sin avisarle al cliente desde aquí). */
  async function aceptar(c: CotizacionDto) {
    setOcupado(c.id);
    setAviso(null);
    const r = await pedirAceptar(c.id, { crearPedido: true, avisar: false, fechaEstimada: null });
    setOcupado(null);
    setAviso(r.ok ? { ok: !r.r.avisoPedido, texto: textoDeAceptada(c.folio, r.r) } : { ok: false, texto: r.error });
    void cargar();
  }

  async function cambiarEstado(c: CotizacionDto, estado: "rechazada" | "enviada") {
    setOcupado(c.id);
    setAviso(null);
    const res = await fetch(`/api/cotizaciones/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estado }),
    }).catch(() => null);
    setOcupado(null);
    if (!res?.ok) setAviso({ ok: false, texto: `No se pudo cambiar ${c.folio}` });
    void cargar();
  }

  const senales = datos?.cotizaciones.filter(conSenal).length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Cotizaciones</h2>
        <Link
          href="/settings/cotizaciones"
          className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" aria-hidden /> Productos y precios
        </Link>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" data-cotizaciones-lista>
        {error && <p className="text-sm text-danger-text">No se pudieron cargar las cotizaciones.</p>}
        {!datos && !error && <p className="text-sm text-text-3">Cargando…</p>}
        {datos && (
          <>
            <div className="flex flex-wrap gap-2">
              <Chip activo={!filtro} onClick={() => setFiltro(null)} texto="Todas" n={datos.cotizaciones.length} />
              {senales > 0 && (
                <Chip
                  activo={filtro === "senal"}
                  onClick={() => setFiltro(filtro === "senal" ? null : "senal")}
                  texto="Parece que aceptó"
                  n={senales}
                  resaltar
                />
              )}
              {ORDEN.map((e) => {
                const n = datos.cotizaciones.filter((c) => c.estado === e).length;
                if (n === 0) return null;
                return (
                  <Chip
                    key={e}
                    activo={filtro === e}
                    onClick={() => setFiltro(filtro === e ? null : e)}
                    texto={ESTADO_INFO[e].etiqueta}
                    n={n}
                  />
                );
              })}
            </div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por folio, cliente o producto"
              className="max-w-sm"
              aria-label="Buscar cotizaciones"
            />
            {aviso && (
              <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                {aviso.texto}
              </p>
            )}
            {datos.cotizaciones.length === 0 ? (
              <div className="max-w-md space-y-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <FileText className="h-6 w-6 text-text-3" aria-hidden />
                <p>
                  Todavía no hay cotizaciones. Se hacen desde la conversación del cliente, con el botón{" "}
                  <strong>«Cotizar»</strong> de la bandeja.
                </p>
              </div>
            ) : visibles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna cotización con ese filtro.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {visibles.map((c) => {
                  const pedido = datos.pedidoDeCotizacion[c.id];
                  return (
                    <li
                      key={c.id}
                      className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[6.5rem_1fr_9rem_auto] sm:items-center"
                    >
                      <span className="flex items-center gap-2 sm:block sm:space-y-1">
                        <a
                          href={`/api/cotizaciones/${c.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs font-semibold hover:underline"
                          title="Ver el PDF"
                        >
                          {c.folio}
                        </a>
                        <span className="block">
                          <EstadoChip estado={c.estado} />
                        </span>
                      </span>
                      <span className="text-right text-sm font-semibold sm:order-3 sm:text-right">
                        {formatoDinero(c.totales.total, c.moneda)}
                        <span className="block text-xs font-normal text-text-3">
                          {new Date(c.enviadaEn ?? c.createdAt).toLocaleDateString("es-MX", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </span>
                      <span className="col-span-2 min-w-0 sm:order-2 sm:col-span-1">
                        {c.conversationId ? (
                          <Link
                            href={`/inbox?conversation=${c.conversationId}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {c.contactoNombre}
                          </Link>
                        ) : (
                          <span className="block truncate text-sm font-medium">{c.contactoNombre}</span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">
                          {productoPrincipal(c.partidas)}
                          {pedido ? ` · Pedido ${pedido}` : ""}
                        </span>
                        {conSenal(c) && (
                          <span
                            title={`«${c.senal!.texto}»`}
                            className="mt-1 inline-block max-w-full truncate rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-text"
                          >
                            Parece que aceptó: «{c.senal!.texto}»
                          </span>
                        )}
                      </span>
                      <span className="col-span-2 flex flex-wrap gap-1 sm:order-4 sm:col-span-1 sm:justify-end">
                        {abierta(c) && (
                          <>
                            <Button size="sm" variant="outline" disabled={ocupado === c.id} onClick={() => void aceptar(c)}>
                              Aceptó
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={ocupado === c.id}
                              onClick={() => void cambiarEstado(c, "rechazada")}
                            >
                              No aceptó
                            </Button>
                          </>
                        )}
                        {(c.estado === "aceptada" || c.estado === "rechazada") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={ocupado === c.id}
                            onClick={() => void cambiarEstado(c, "enviada")}
                          >
                            Deshacer
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Chip(props: { activo: boolean; onClick: () => void; texto: string; n: number; resaltar?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.activo}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        props.activo
          ? "border-primary bg-brand-tint text-brand-text"
          : props.resaltar
            ? "border-success-text/40 bg-success-tint text-success-text"
            : "text-text-2 hover:border-text-3 hover:text-foreground"
      )}
    >
      {props.texto} <span className="font-mono text-xs opacity-70">{props.n}</span>
    </button>
  );
}
