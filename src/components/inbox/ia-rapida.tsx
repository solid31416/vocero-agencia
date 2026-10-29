"use client";

import { Bot, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";

/**
 * Módulo de la agencia (Treviño AI) — La IA de la conversación, a la mano.
 *
 * El mismo interruptor de «IA en esta conversación» (Detalles), en el
 * encabezado del hilo, junto al nombre: pausar o reactivar sin abrir el panel.
 * Manda exactamente el mismo PATCH que el panel (`onPatchConversation`):
 * con atención humana, reactiva (`reactivate`); si no, alterna `aiEnabled`.
 */
export function IaRapida({
  conversation,
  onPatchConversation,
}: {
  conversation: ConversationDto;
  onPatchConversation: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<void>;
}) {
  const traspaso = Boolean(conversation.handoffAt);
  const activa = conversation.aiEnabled && !traspaso;

  const texto = traspaso ? "Humano" : activa ? "IA activa" : "IA en pausa";
  const accion = traspaso
    ? "Reactivar la IA (ahora la atiende una persona)"
    : activa
      ? "Pausar la IA en esta conversación"
      : "Reactivar la IA en esta conversación";

  return (
    <button
      type="button"
      onClick={() =>
        void onPatchConversation(
          traspaso ? { reactivate: true } : { aiEnabled: !conversation.aiEnabled }
        )
      }
      aria-label={accion}
      title={accion}
      aria-pressed={activa}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        activa
          ? "border-success-soft bg-success-tint text-success-text hover:opacity-80"
          : "border-warning-soft bg-warning-tint text-warning-text hover:opacity-80"
      )}
    >
      {traspaso ? (
        <UserRound className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
      ) : (
        <Bot className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
      )}
      <span className="max-sm:sr-only">{texto}</span>
    </button>
  );
}
