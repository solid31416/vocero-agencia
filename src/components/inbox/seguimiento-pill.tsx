"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { describirDias, type EstadoConversacionDto } from "@/lib/seguimiento";
import { ESTADO_ENVIO } from "@/components/settings/seguimiento-client";

/**
 * Módulo de la agencia (Treviño AI) — el seguimiento automático de ESTE
 * cliente, en el encabezado del hilo: si corre, cuándo sale el siguiente, lo
 * que ya salió, y «Detener» / «Reanudar».
 *
 * Solo se dibuja con la bandera SEGUIMIENTO_AUTOMATICO (decidido en el servidor).
 */

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function SeguimientoPill({ conversation }: { conversation: ConversationDto }) {
  const [estado, setEstado] = useState<EstadoConversacionDto | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/seguimiento?conversationId=${encodeURIComponent(conversation.id)}`).catch(
      () => null
    );
    if (!res?.ok) return setEstado(null);
    setEstado((await res.json()) as EstadoConversacionDto);
  }, [conversation.id]);

  // Se recarga al cambiar de conversación y cuando llega o sale un mensaje.
  useEffect(() => {
    void cargar();
  }, [cargar, conversation.lastMessageAt]);

  if (!estado || conversation.channel !== "whatsapp") return null;

  const corre = estado.activo && !estado.motivo && estado.siguiente;
  const etiqueta = !estado.activo
    ? "Seguimiento apagado"
    : estado.pausada
      ? "Seguimiento detenido"
      : corre
        ? `Seguimiento ${fechaCorta(estado.siguiente!.fecha).split(",")[0]}`
        : "Sin seguimiento";

  async function pausar(pausada: boolean) {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/seguimiento", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, pausada }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) return setError("No se pudo cambiar");
    setEstado((await res.json()) as EstadoConversacionDto);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={etiqueta}
        title={etiqueta}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          corre
            ? "border-brand-text/40 bg-brand-tint text-brand-text"
            : "border-border-strong text-text-2 hover:border-text-3 hover:text-foreground"
        )}
      >
        <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        <span className="max-sm:sr-only">{corre ? etiqueta.replace("Seguimiento ", "Seg. ") : "Seguimiento"}</span>
      </button>
      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Seguimiento automático"
          onClick={(e) => e.target === e.currentTarget && setAbierto(false)}
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-5 shadow-lg">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Seguimiento automático
              </h3>
              <p className="text-sm text-muted-foreground">{conversation.contact.name}</p>
            </div>

            {!estado.activo ? (
              <p className="text-sm">
                Está apagado para todo el negocio. Se enciende en{" "}
                <Link href="/settings/seguimiento" className="font-medium text-brand-text underline underline-offset-2">
                  Ajustes → Seguimiento
                </Link>
                .
              </p>
            ) : corre ? (
              <p className="text-sm">
                Si no vuelve a escribir, le mandamos el paso de{" "}
                <strong>{describirDias(estado.siguiente!.dias)}</strong> el{" "}
                <strong>{fechaCorta(estado.siguiente!.fecha)}</strong>.
              </p>
            ) : (
              <p className="text-sm">
                No le toca seguimiento: <span className="text-muted-foreground">{estado.motivo}</span>.
              </p>
            )}

            {estado.enviados.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Ya salió</p>
                <ul className="space-y-1 text-sm">
                  {estado.enviados.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ESTADO_ENVIO[e.estado].clase)}
                      >
                        {ESTADO_ENVIO[e.estado].texto}
                      </span>
                      <span>paso de {describirDias(e.dias)}</span>
                      <span className="text-muted-foreground">{fechaCorta(e.creadoEn)}</span>
                      {e.estado !== "enviado" && e.detalle && (
                        <span className="w-full text-xs text-muted-foreground">{e.detalle}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-sm text-danger-text">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAbierto(false)}>
                Cerrar
              </Button>
              {estado.pausada ? (
                <Button onClick={() => void pausar(false)} disabled={ocupado}>
                  Reanudar para este cliente
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void pausar(true)} disabled={ocupado}>
                  Detener para este cliente
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
