"use client";

import { useState } from "react";
import { Check, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sePuedeAceptar, type CotizacionDto } from "@/lib/cotizaciones";
import type { PedidoDto } from "@/lib/pedidos";

/**
 * Módulo de la agencia (Treviño AI) — «Marcar aceptada» de una cotización.
 *
 * Con un clic la cotización queda aceptada y, si el módulo de pedidos está
 * encendido, nace su pedido con las partidas y el total (sin volver a
 * escribirlo). Si ya tiene pedido, solo se muestra su folio.
 */

export type RespuestaAceptar = {
  cotizacion: CotizacionDto;
  pedido: PedidoDto | null;
  yaExistia: boolean;
  avisoPedido: string | null;
};

export async function pedirAceptar(
  cotizacionId: string,
  datos: { crearPedido: boolean; avisar: boolean; fechaEstimada: string | null; concepto?: string; monto?: number | null }
): Promise<{ ok: true; r: RespuestaAceptar } | { ok: false; error: string }> {
  const res = await fetch(`/api/cotizaciones/${cotizacionId}/aceptar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(datos),
  }).catch(() => null);
  if (!res?.ok) {
    const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: d?.error?.message ?? "No se pudo marcar como aceptada" };
  }
  return { ok: true, r: (await res.json()) as RespuestaAceptar };
}

/** El texto que confirma lo que pasó, para quien dio el clic. */
export function textoDeAceptada(folio: string, r: RespuestaAceptar): string {
  if (r.pedido && r.yaExistia) return `${folio} aceptada. Ya tenía el pedido ${r.pedido.folio}.`;
  if (r.pedido) return `${folio} aceptada y se creó el pedido ${r.pedido.folio}.`;
  if (r.avisoPedido) return `${folio} aceptada, pero el pedido no se creó: ${r.avisoPedido}`;
  return `${folio} aceptada.`;
}

export function AceptarCotizacion({
  cotizacion,
  pedidosActivos,
  pedidoFolio,
  onListo,
}: {
  cotizacion: CotizacionDto;
  pedidosActivos: boolean;
  /** Folio del pedido que ya nació de esta cotización, si lo hay. */
  pedidoFolio: string | null;
  onListo: (texto: string, ok: boolean) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [crear, setCrear] = useState(true);
  const [avisar, setAvisar] = useState(true);
  const [fecha, setFecha] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (pedidoFolio) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-text">
        <Package className="h-3 w-3" aria-hidden /> Pedido {pedidoFolio}
      </span>
    );
  }

  const aceptable = sePuedeAceptar(cotizacion.estado);
  const sinPedido = cotizacion.estado === "aceptada" && pedidosActivos;
  if (!aceptable && !sinPedido) return null;

  async function confirmar() {
    setOcupado(true);
    const r = await pedirAceptar(cotizacion.id, {
      crearPedido: pedidosActivos && crear,
      avisar,
      fechaEstimada: fecha || null,
    });
    setOcupado(false);
    if (!r.ok) return onListo(r.error, false);
    setAbierto(false);
    onListo(textoDeAceptada(cotizacion.folio, r.r), !r.r.avisoPedido);
  }

  if (!abierto) {
    return (
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAbierto(true)}>
        {aceptable ? (
          <>
            <Check className="mr-1 h-3.5 w-3.5" /> Marcar aceptada
          </>
        ) : (
          <>
            <Package className="mr-1 h-3.5 w-3.5" /> Crear pedido
          </>
        )}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border border-dashed p-2 text-sm">
      {aceptable && (
        <p className="text-text-2">
          El cliente aceptó la <strong>{cotizacion.folio}</strong>.
        </p>
      )}
      {pedidosActivos && (
        <>
          {aceptable && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={crear} onChange={(e) => setCrear(e.target.checked)} />
              Crear su pedido con esta cotización
            </label>
          )}
          {(crear || !aceptable) && (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
                Avisarle que su pedido quedó confirmado
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor={`fecha-${cotizacion.id}`} className="text-xs font-normal text-text-2">
                  Entrega estimada (opcional)
                </Label>
                <Input
                  id={`fecha-${cotizacion.id}`}
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-8 w-auto"
                />
              </div>
            </>
          )}
        </>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void confirmar()} disabled={ocupado}>
          {ocupado ? "Guardando…" : "Confirmar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAbierto(false)} disabled={ocupado}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
