"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, MessageSquare, MessageSquareOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatoDinero } from "@/lib/cotizaciones";
import {
  MAX_MENSAJE,
  armarMensaje,
  fechaLegible,
  type Etapa,
  type Movimiento,
  type PedidoDto,
} from "@/lib/pedidos";

/**
 * Módulo de la agencia (Treviño AI) — un pedido: su avance, su historial y el
 * formulario para moverlo de etapa (con el aviso al cliente ya escrito, que
 * se puede editar). Se usa en la bandeja y en la pantalla «Pedidos».
 */

const AVISO: Record<Movimiento["aviso"], { texto: string; clase: string }> = {
  texto: { texto: "Avisado por WhatsApp", clase: "text-success-text" },
  plantilla: { texto: "Avisado con plantilla", clase: "text-success-text" },
  no: { texto: "Sin aviso", clase: "text-text-3" },
  fallo: { texto: "El aviso falló", clase: "text-danger-text" },
};

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** La barra de avance: una rayita por etapa. */
export function AvancePedido({ pedido, etapas }: { pedido: PedidoDto; etapas: Etapa[] }) {
  const i = pedido.etapaIndice;
  return (
    <div className="flex gap-1" aria-label={`Etapa ${i + 1} de ${etapas.length}: ${pedido.etapaNombre}`}>
      {etapas.map((e, j) => (
        <span
          key={e.id}
          title={e.nombre}
          className={cn("h-1.5 flex-1 rounded-full", i >= 0 && j <= i ? "bg-primary" : "bg-border")}
        />
      ))}
    </div>
  );
}

export function PedidoTarjeta({
  pedido,
  etapas,
  puedeBorrar = false,
  conEnlace = false,
  onCambio,
}: {
  pedido: PedidoDto;
  etapas: Etapa[];
  puedeBorrar?: boolean;
  /** En la pantalla «Pedidos»: enlace a la conversación. */
  conEnlace?: boolean;
  onCambio: (p: PedidoDto | null) => void;
}) {
  const siguiente = etapas[pedido.etapaIndice + 1] ?? null;
  const [etapaId, setEtapaId] = useState(siguiente?.id ?? pedido.etapaId);
  const etapa = etapas.find((e) => e.id === etapaId) ?? null;
  const [fecha, setFecha] = useState(pedido.fechaEstimada ?? "");
  const textoBase = useMemo(
    () =>
      etapa
        ? armarMensaje(etapa.mensaje, {
            contacto: pedido.contactoNombre,
            folio: pedido.folio,
            estado: etapa.nombre,
            fechaEstimada: fecha || null,
            concepto: pedido.concepto,
          })
        : "",
    [etapa, pedido.contactoNombre, pedido.folio, pedido.concepto, fecha]
  );
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [avisar, setAvisar] = useState(true);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const texto = mensaje ?? textoBase;

  // Al moverse el pedido, el formulario apunta ya a la etapa que sigue.
  useEffect(() => {
    setEtapaId(siguiente?.id ?? pedido.etapaId);
    setFecha(pedido.fechaEstimada ?? "");
  }, [pedido.etapaId, pedido.fechaEstimada, siguiente?.id]);

  async function enviar(cuerpo: Record<string, unknown>, ok: string) {
    setOcupado(true);
    setAviso(null);
    const res = await fetch(`/api/pedidos/${pedido.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    }).catch(() => null);
    setOcupado(false);
    const d = (await res?.json().catch(() => null)) as { pedido?: PedidoDto; error?: { message?: string } } | null;
    if (!res?.ok || !d?.pedido) return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    const ultimo = d.pedido.historial[d.pedido.historial.length - 1];
    const fallo = cuerpo.etapaId && ultimo && (ultimo.aviso === "fallo" || (avisar && ultimo.aviso === "no"));
    setAviso(fallo ? { ok: false, texto: `Movido, pero ${ultimo.detalle ?? "no se avisó"}` } : { ok: true, texto: ok });
    setMensaje(null);
    setNota("");
    onCambio(d.pedido);
  }

  async function borrar() {
    if (!window.confirm(`¿Quitar el pedido ${pedido.folio}? Úsalo solo si se capturó por error.`)) return;
    const res = await fetch(`/api/pedidos/${pedido.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) onCambio(null);
    else setAviso({ ok: false, texto: "No se pudo quitar" });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3" data-pedido={pedido.folio}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-text-3">
            {pedido.folio}
            {conEnlace && pedido.conversationId && (
              <>
                {" · "}
                <Link
                  href={`/inbox?conversation=${encodeURIComponent(pedido.conversationId)}`}
                  className="font-sans font-medium text-brand-text hover:underline"
                >
                  {pedido.contactoNombre}
                </Link>
              </>
            )}
          </p>
          <p className="text-sm font-medium">{pedido.concepto}</p>
          <p className="text-xs text-muted-foreground">
            {pedido.monto !== null && <>{formatoDinero(pedido.monto)} · </>}
            {pedido.fechaEstimada ? `Entrega estimada: ${fechaLegible(pedido.fechaEstimada)}` : "Sin fecha estimada"}
          </p>
        </div>
        <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-text">
          {pedido.etapaNombre}
        </span>
      </div>
      <AvancePedido pedido={pedido} etapas={etapas} />

      <div className="space-y-2 rounded-md bg-subtle p-2.5">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`etapa-${pedido.id}`}>Mover a</Label>
            <select
              id={`etapa-${pedido.id}`}
              value={etapaId}
              onChange={(e) => {
                setEtapaId(e.target.value);
                setMensaje(null);
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {etapas.map((e, j) => (
                <option key={e.id} value={e.id}>
                  {j + 1}. {e.nombre}
                  {e.id === pedido.etapaId ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`fecha-${pedido.id}`}>Entrega estimada</Label>
            <Input id={`fecha-${pedido.id}`} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          Avisarle al cliente por WhatsApp
        </label>
        {avisar && (
          <Textarea
            rows={3}
            maxLength={MAX_MENSAJE}
            value={texto}
            onChange={(e) => setMensaje(e.target.value)}
            aria-label="Mensaje para el cliente"
            placeholder="Esta etapa no tiene mensaje: escribe uno o quita el aviso"
          />
        )}
        <Input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={500}
          placeholder="Nota interna (opcional): guía, contenedor, quién instaló…"
          aria-label="Nota interna"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={ocupado || !etapa || (etapaId === pedido.etapaId && (fecha || null) === pedido.fechaEstimada)}
            onClick={() => {
              const cambiaFecha = (fecha || null) !== pedido.fechaEstimada;
              if (etapaId === pedido.etapaId) {
                return void enviar({ fechaEstimada: fecha || null }, "Fecha guardada");
              }
              void enviar(
                {
                  etapaId,
                  nota,
                  avisar,
                  ...(avisar ? { mensaje: texto } : {}),
                  ...(cambiaFecha ? { fechaEstimada: fecha || null } : {}),
                },
                avisar ? "Movido y avisado" : "Movido"
              );
            }}
          >
            <Check className="mr-1 h-4 w-4" />
            {etapaId === pedido.etapaId ? "Guardar fecha" : `Mover a «${etapa?.nombre ?? ""}»`}
          </Button>
          {puedeBorrar && (
            <Button size="sm" variant="outline" onClick={() => void borrar()} disabled={ocupado}>
              <Trash2 className="mr-1 h-4 w-4" /> Quitar
            </Button>
          )}
          {aviso && (
            <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
              {aviso.texto}
            </span>
          )}
        </div>
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-text-2">
          Historial ({pedido.historial.length})
        </summary>
        <ol className="mt-2 space-y-1.5 border-l pl-3 text-sm">
          {[...pedido.historial].reverse().map((m, i) => (
            <li key={`${m.en}-${i}`}>
              <span className="font-medium">{m.etapaNombre}</span>{" "}
              <span className="text-xs text-muted-foreground">{cuando(m.en)}</span>
              <span className={cn("ml-2 inline-flex items-center gap-1 text-xs", AVISO[m.aviso].clase)}>
                {m.aviso === "texto" || m.aviso === "plantilla" ? (
                  <MessageSquare className="h-3 w-3" aria-hidden />
                ) : (
                  <MessageSquareOff className="h-3 w-3" aria-hidden />
                )}
                {AVISO[m.aviso].texto}
              </span>
              {m.nota && <p className="text-xs text-text-2">{m.nota}</p>}
              {m.detalle && m.aviso !== "texto" && <p className="text-xs text-muted-foreground">{m.detalle}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
