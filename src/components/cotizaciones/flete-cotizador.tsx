"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { formatoDinero, type Partida, type Producto } from "@/lib/cotizaciones";
import { ESTADOS_MX, conceptoDeFlete, type OpcionFlete } from "@/lib/fletes";

/**
 * Módulo de la agencia — Fletes en el cotizador: busca en el tabulador
 * (Ajustes → Ventas → Fletes) cuánto se le cobra al cliente por llevar N
 * piezas a su ciudad y lo agrega como partida. El costo y la transportista se
 * ven aquí (es el equipo) pero no salen en la cotización.
 */

const claseSelect = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/** Las piezas de producto (no los extras ni los fletes) de la cotización. */
export function piezasDeLaCotizacion(partidas: readonly Partida[], productos: readonly Producto[]): number {
  let n = 0;
  for (const p of partidas) {
    if (!p.concepto.trim() || !(p.cantidad > 0)) continue;
    const prod = p.productoId ? productos.find((x) => x.id === p.productoId) : null;
    if (prod?.extra) continue;
    if (!prod && /flete|env[ií]o|instalaci/i.test(p.concepto)) continue;
    n += p.cantidad;
  }
  return Math.max(1, Math.round(n));
}

export function FleteCotizador({
  partidas,
  productos,
  moneda,
  onAgregar,
}: {
  partidas: readonly Partida[];
  productos: readonly Producto[];
  moneda: "MXN" | "USD";
  onAgregar: (p: Partida) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [piezas, setPiezas] = useState<number | null>(null);
  const [res, setRes] = useState<{ origen: string; opciones: OpcionFlete[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const piezasAuto = piezasDeLaCotizacion(partidas, productos);
  const n = piezas ?? piezasAuto;
  const dinero = (x: number) => formatoDinero(x, moneda);

  async function buscar() {
    if (!estado) return setError("Elige el estado");
    setBuscando(true);
    setError(null);
    const q = new URLSearchParams({ estado, ciudad, piezas: String(n) });
    const r = await fetch(`/api/fletes/opciones?${q}`).catch(() => null);
    setBuscando(false);
    const d = (await r?.json().catch(() => null)) as { origen?: string; opciones?: OpcionFlete[]; error?: { message?: string } } | null;
    if (!r?.ok || !d?.opciones) return setError(d?.error?.message ?? "No se pudo consultar el tabulador");
    setRes({ origen: d.origen ?? "", opciones: d.opciones });
  }

  function agregar(o: OpcionFlete) {
    onAgregar({
      productoId: null,
      concepto: conceptoDeFlete(o, { estado, ciudad }, res?.origen ?? ""),
      descripcion: o.dias ? `Entrega estimada: ${o.dias}` : "",
      cantidad: 1,
      unidad: "servicio",
      precio: o.precio,
    });
    setAbierto(false);
    setRes(null);
  }

  if (!abierto) {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAbierto(true)} data-flete-abrir>
        <Truck className="mr-1 h-4 w-4" aria-hidden /> Agregar flete
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2.5" data-flete-cotizador>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Truck className="h-4 w-4" aria-hidden /> Flete del tabulador
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_5.5rem]">
        <select
          aria-label="Estado de destino"
          className={claseSelect}
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setRes(null);
          }}
        >
          <option value="">— Estado —</option>
          {ESTADOS_MX.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <Input
          aria-label="Ciudad de destino"
          placeholder="Ciudad"
          value={ciudad}
          onChange={(e) => {
            setCiudad(e.target.value);
            setRes(null);
          }}
        />
        <NumeroInput
          aria-label="Piezas a enviar"
          title="Piezas a enviar"
          min={1}
          max={1000}
          entero
          value={n}
          onValueChange={(x) => {
            setPiezas(x);
            setRes(null);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={buscar} disabled={buscando}>
          {buscando ? "Buscando…" : "Buscar tarifa"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
          Cerrar
        </Button>
      </div>
      {error && <p className="text-xs text-danger-text">{error}</p>}
      {res && res.opciones.length === 0 && (
        <p className="text-xs text-text-3" data-flete-sin-tarifa>
          No hay tarifa para {n} pieza{n === 1 ? "" : "s"} a ese destino. Escribe el flete a mano como partida, o
          agrega la tarifa en{" "}
          <a href="/settings/fletes" className="underline">
            Ventas → Fletes
          </a>
          .
        </p>
      )}
      {res && res.opciones.length > 0 && (
        <ul className="space-y-1.5">
          {res.opciones.map((o, k) => (
            <li key={o.tarifaId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-subtle p-2 text-xs">
              <span>
                <span className="text-sm font-medium">{dinero(o.precio)}</span>
                {k === 0 && " · recomendada"}
                <br />
                <span className="text-text-3">
                  {o.transportista} · {o.destino}
                  {o.dias && ` · ${o.dias}`} · te cuesta {dinero(o.costo)} (margen {dinero(o.margen)})
                  {o.vieja && " · ⚠ tarifa sin actualizar"}
                </span>
              </span>
              <Button type="button" size="sm" variant={k === 0 ? "default" : "outline"} onClick={() => agregar(o)} data-flete-agregar>
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
