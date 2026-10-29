"use client";

import { useState } from "react";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Módulo de la agencia (Treviño AI) — Aviso al cliente al reactivar la IA.
 *
 * Cuando una persona del equipo atendió y devuelve la conversación al agente,
 * el cliente no se entera del cambio. Esta ventana sale al reactivar (solo
 * con la ventana de 24 h abierta) y ofrece mandarle un aviso editable antes.
 *
 * El orden importa: primero sale el aviso y DESPUÉS se reactiva. Enviar desde
 * la bandeja pausa la IA (módulo «pausar al responder»); al revés, el aviso
 * la volvería a apagar. El texto que se usó se recuerda en este navegador.
 */

export const AVISO_POR_DEFECTO =
  "Te dejo con nuestra asistente virtual para seguir ayudándote 😊. Si necesitas hablar con alguien del equipo, solo dímelo.";

const LLAVE = "vocero.avisoReactivarIa";

function leerTexto(): string {
  try {
    return localStorage.getItem(LLAVE) || AVISO_POR_DEFECTO;
  } catch {
    return AVISO_POR_DEFECTO;
  }
}

function guardarTexto(texto: string) {
  try {
    localStorage.setItem(LLAVE, texto);
  } catch {
    // Sin almacenamiento (ventana privada): se usa el de por defecto la próxima vez.
  }
}

export function AvisoReactivar({
  conversation,
  onReactivar,
  onCancel,
  onAvisoEnviado,
}: {
  conversation: ConversationDto;
  /** Reactiva la IA (el PATCH de siempre). */
  onReactivar: () => Promise<void>;
  onCancel: () => void;
  /** Para refrescar el hilo con el aviso recién enviado. */
  onAvisoEnviado: () => void;
}) {
  const [texto, setTexto] = useState(leerTexto);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reactivarYAvisar() {
    const limpio = texto.trim();
    if (!limpio) {
      setError("Escribe el aviso o reactiva sin avisar.");
      return;
    }
    setOcupado(true);
    setError(null);
    const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: limpio }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setOcupado(false);
      setError(
        `${data?.error?.message ?? "No se pudo enviar el aviso"}. La IA sigue en pausa.`
      );
      return;
    }
    guardarTexto(limpio);
    onAvisoEnviado();
    await onReactivar();
    setOcupado(false);
  }

  async function reactivarSinAvisar() {
    setOcupado(true);
    await onReactivar();
    setOcupado(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="aviso-reactivar-titulo"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-lg border bg-popover p-5 shadow-pop"
      >
        <div>
          <h3 id="aviso-reactivar-titulo" className="text-[16px] font-bold">
            Reactivar la IA
          </h3>
          <p className="mt-1 text-sm text-text-3">
            ¿Le avisas a {conversation.contact.name} que lo vuelve a atender la
            asistente? Puedes cambiar el mensaje; se recuerda para la próxima.
          </p>
        </div>

        <Textarea
          aria-label="Aviso para el cliente"
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void reactivarSinAvisar()}
            disabled={ocupado}
          >
            Reactivar sin avisar
          </Button>
          <Button type="button" onClick={() => void reactivarYAvisar()} disabled={ocupado}>
            {ocupado ? "Enviando…" : "Avisar y reactivar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
