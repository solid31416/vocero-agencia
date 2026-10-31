"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Hand, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import { RENGLONES, textoMotivo, type ResumenDto } from "@/lib/resumen-traspaso";

/**
 * Módulo de la agencia (Treviño AI) — Resumen para quien atiende, arriba del
 * chat. Sale cuando la IA está pausada (el agente la pasó o alguien la pausó)
 * o cuando ya hay un resumen; con la IA contestando queda plegado. Sin la
 * bandera (404) o apagado en Ajustes → IA, no se dibuja nada.
 */

type Estado = { activo: boolean; resumen: ResumenDto | null; generando: boolean };

function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function ResumenTraspaso({ conversation }: { conversation: ConversationDto }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [armando, setArmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pausada = !conversation.aiEnabled || Boolean(conversation.handoffAt);
  const id = conversation.id;

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}/resumen`).catch(() => null);
    if (!res?.ok) return setEstado(null);
    setEstado((await res.json()) as Estado);
  }, [id]);

  // Al cambiar de conversación, al pausar/reactivar y con cada aviso de la bandeja.
  useEffect(() => {
    void cargar();
  }, [cargar, conversation]);

  useEffect(() => {
    setAbierto(pausada);
    setError(null);
  }, [id, pausada]);

  // Mientras el servidor lo arma (tras un traspaso), volver a preguntar.
  useEffect(() => {
    if (!estado?.generando) return;
    const t = setTimeout(() => void cargar(), 3000);
    return () => clearTimeout(t);
  }, [estado, cargar]);

  async function rehacer() {
    setArmando(true);
    setError(null);
    const res = await fetch(`/api/conversations/${id}/resumen`, { method: "POST" }).catch(() => null);
    setArmando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(d?.error?.message ?? "No se pudo armar el resumen");
    }
    setEstado((await res.json()) as Estado);
    setAbierto(true);
  }

  if (!estado?.activo) return null;
  const { resumen } = estado;
  const ocupado = armando || estado.generando;
  if (!resumen && !pausada && !ocupado) return null;

  return (
    <div
      data-resumen-traspaso
      className="border-b border-warning-soft bg-warning-tint px-3 py-2 text-sm md:px-4 lg:tarjeta lg:border-b-0 lg:px-5"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          disabled={!resumen}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium text-warning-text"
          aria-expanded={abierto}
        >
          <Hand className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">
            Resumen para quien atiende
            {resumen && (
              <span className="font-normal text-text-3"> · {haceCuanto(resumen.generadoEn)}</span>
            )}
          </span>
          {resumen && (
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", abierto && "rotate-180")} aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => void rehacer()}
          disabled={ocupado}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-strong bg-card px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
        >
          {ocupado ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          {ocupado ? "Armando…" : resumen ? "Actualizar" : "Resumir conversación"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger-text">{error}</p>}
      {resumen && abierto && (
        <dl className="mt-2 grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
          {RENGLONES.map((r) => (
            <div key={r.campo} className="contents">
              <dt className="font-semibold text-foreground">{r.titulo}:</dt>
              <dd className="text-text-2">{resumen.resumen[r.campo] || "—"}</dd>
            </div>
          ))}
          <dt className="font-semibold text-foreground">Por qué:</dt>
          <dd className="text-text-2">{textoMotivo(resumen.motivo)}</dd>
        </dl>
      )}
    </div>
  );
}
