"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Package, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { fechaLegible, type Etapa, type PedidoDto } from "@/lib/pedidos";
import { AvancePedido, PedidoTarjeta } from "@/components/pedidos/pedido-tarjeta";

/**
 * Módulo de la agencia (Treviño AI) — la pantalla «Pedidos»: todos los
 * pedidos, contados por etapa, con buscador. Al tocar uno se abre su tarjeta
 * para moverlo de etapa sin ir a la conversación.
 */

type Datos = { pedidos: PedidoDto[]; etapas: Etapa[] };

export function PedidosLista({ puedeBorrar = false }: { puedeBorrar?: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/pedidos").catch(() => null);
    if (!res?.ok) return setError(true);
    setDatos((await res.json()) as Datos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    if (!datos) return [];
    const texto = q.trim().toLowerCase();
    return datos.pedidos.filter(
      (p) =>
        (!filtro || p.etapaId === filtro) &&
        (!texto || `${p.folio} ${p.contactoNombre} ${p.concepto}`.toLowerCase().includes(texto))
    );
  }, [datos, filtro, q]);

  const abiertoP = datos?.pedidos.find((p) => p.id === abierto) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Pedidos</h2>
        <Link
          href="/settings/pedidos"
          className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" aria-hidden /> Etapas y mensajes
        </Link>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {error && <p className="text-sm text-danger-text">No se pudieron cargar los pedidos.</p>}
        {!datos && !error && <p className="text-sm text-text-3">Cargando…</p>}
        {datos && (
          <>
            <div className="flex flex-wrap gap-2">
              <Chip activo={!filtro} onClick={() => setFiltro(null)} texto="Todos" n={datos.pedidos.length} />
              {datos.etapas.map((e) => (
                <Chip
                  key={e.id}
                  activo={filtro === e.id}
                  onClick={() => setFiltro(filtro === e.id ? null : e.id)}
                  texto={e.nombre}
                  n={datos.pedidos.filter((p) => p.etapaId === e.id).length}
                />
              ))}
            </div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por folio, cliente o producto"
              className="max-w-sm"
              aria-label="Buscar pedidos"
            />
            {datos.pedidos.length === 0 ? (
              <div className="max-w-md space-y-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <Package className="h-6 w-6 text-text-3" aria-hidden />
                <p>
                  Todavía no hay pedidos. Se crean desde la conversación del cliente, con el botón{" "}
                  <strong>«Pedido»</strong> de la bandeja (o a partir de una cotización aceptada).
                </p>
              </div>
            ) : visibles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún pedido con ese filtro.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {visibles.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setAbierto(p.id)}
                      className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-3 py-2.5 text-left hover:bg-accent/50 sm:grid-cols-[7rem_1fr_10rem_9rem]"
                    >
                      <span className="font-mono text-xs text-text-3 sm:self-center">{p.folio}</span>
                      <span className="col-span-2 min-w-0 sm:col-span-1">
                        <span className="block truncate text-sm font-medium">{p.contactoNombre}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.concepto}</span>
                      </span>
                      <span className="space-y-1 sm:self-center">
                        <span className="block text-xs font-medium text-brand-text">{p.etapaNombre}</span>
                        <AvancePedido pedido={p} etapas={datos.etapas} />
                      </span>
                      <span className="text-xs text-muted-foreground sm:self-center sm:text-right">
                        {p.fechaEstimada ? fechaLegible(p.fechaEstimada) : "Sin fecha"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {abiertoP && datos && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Pedido ${abiertoP.folio}`}
          onClick={(e) => e.target === e.currentTarget && setAbierto(null)}
        >
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Pedido {abiertoP.folio}</h3>
              <button
                type="button"
                onClick={() => setAbierto(null)}
                className="rounded-md px-2 py-1 text-sm text-text-2 hover:bg-accent"
              >
                Cerrar
              </button>
            </div>
            <PedidoTarjeta
              pedido={abiertoP}
              etapas={datos.etapas}
              conEnlace
              puedeBorrar={puedeBorrar}
              onCambio={(nuevo) => {
                if (!nuevo) setAbierto(null);
                void cargar();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ activo, onClick, texto, n }: { activo: boolean; onClick: () => void; texto: string; n: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        activo ? "border-primary bg-brand-tint text-brand-text" : "text-text-2 hover:border-text-3 hover:text-foreground"
      )}
    >
      {texto} <span className="font-mono text-xs opacity-70">{n}</span>
    </button>
  );
}
