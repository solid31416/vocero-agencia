"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

/**
 * Módulo de la agencia (Treviño AI) — Agendar desde la bandeja.
 *
 * El CRM ya sabía agendar por una persona (`POST /api/bookings` con
 * `kind: "session"`, la misma validación y el mismo candado anti doble-booking
 * que el agente), pero ninguna pantalla lo ofrecía: Citas solo deja bloquear.
 * Esto lo pone en el encabezado del hilo: eliges un hueco libre
 * (`GET /api/calendar/availability`), confirmas, y si la ventana de 24 h está
 * abierta le mandas al cliente la confirmación (texto editable).
 *
 * Solo se dibuja con la agenda encendida (`AGENDA`, decidido en el servidor).
 */

type Hueco = {
  startUtc: string;
  dayIso: string;
  dayLabel: string;
  time: string;
  label: string;
};

type Resultado = { meetingLink?: string | null; linkPending?: boolean; label?: string };

function textoDeConfirmacion(nombre: string, etiqueta: string): string {
  const primerNombre = nombre.trim().split(/\s+/)[0] ?? "";
  return `¡Listo${primerNombre ? `, ${primerNombre}` : ""}! Tu cita quedó para el ${etiqueta}. Te esperamos 😊`;
}

export function AgendarCita({
  conversation,
  onDone,
}: {
  conversation: ConversationDto;
  /** Tras agendar (y enviar, si se envió): refrescar hilo y lista. */
  onDone: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Agendar una cita con este cliente"
        title="Agendar una cita con este cliente"
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium leading-5 text-text-2 transition-colors",
          "hover:border-text-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
        <span className="max-sm:sr-only">Agendar</span>
      </button>
      {abierto && (
        <VentanaAgendar
          conversation={conversation}
          onCancel={() => setAbierto(false)}
          onDone={() => {
            setAbierto(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

function VentanaAgendar({
  conversation,
  onCancel,
  onDone,
}: {
  conversation: ConversationDto;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [huecos, setHuecos] = useState<Hueco[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [elegido, setElegido] = useState<Hueco | null>(null);
  const [nota, setNota] = useState("");
  const [avisar, setAvisar] = useState(conversation.windowOpen);
  const [mensaje, setMensaje] = useState("");
  const [editado, setEditado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargarHuecos() {
    setCargando(true);
    const res = await fetch("/api/calendar/availability").catch(() => null);
    const data = (await res?.json().catch(() => null)) as { slots?: Hueco[] } | null;
    setHuecos(res?.ok ? (data?.slots ?? []) : null);
    setCargando(false);
  }

  useEffect(() => {
    void cargarHuecos();
  }, []);

  // El texto sigue al horario elegido hasta que la persona lo edita.
  useEffect(() => {
    if (elegido && !editado) {
      setMensaje(textoDeConfirmacion(conversation.contact.name, elegido.label));
    }
  }, [elegido, editado, conversation.contact.name]);

  const porDia = useMemo(() => {
    const grupos = new Map<string, { dayLabel: string; huecos: Hueco[] }>();
    for (const h of huecos ?? []) {
      const g = grupos.get(h.dayIso) ?? { dayLabel: h.dayLabel, huecos: [] };
      g.huecos.push(h);
      grupos.set(h.dayIso, g);
    }
    return [...grupos.values()];
  }, [huecos]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!elegido) return;
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "session",
        contactId: conversation.contact.id,
        conversationId: conversation.id,
        startUtc: elegido.startUtc,
        notes: nota.trim() || null,
      }),
    }).catch(() => null);
    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      setOcupado(false);
      if (data?.error?.code === "slot_taken") {
        setError("Ese horario se acaba de ocupar. Elige otro.");
        setElegido(null);
        void cargarHuecos();
      } else {
        setError(data?.error?.message ?? "No se pudo agendar la cita");
      }
      return;
    }
    const cita = (await res.json().catch(() => null)) as Resultado | null;

    if (avisar && conversation.windowOpen && mensaje.trim()) {
      const enlace = cita?.meetingLink
        ? `\n\nEnlace de la reunión: ${cita.meetingLink}`
        : cita?.linkPending
          ? "\n\nEl enlace de la reunión te lo mandamos en un momento."
          : "";
      const envio = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `${mensaje.trim()}${enlace}` }),
      }).catch(() => null);
      if (!envio?.ok) {
        setOcupado(false);
        setError(
          "La cita quedó agendada, pero no se pudo enviar la confirmación. Escríbesela desde la bandeja."
        );
        onDone();
        return;
      }
    }
    setOcupado(false);
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agendar-titulo"
      onClick={onCancel}
    >
      <form
        onSubmit={confirmar}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg border bg-popover p-5 shadow-pop"
      >
        <div>
          <h3 id="agendar-titulo" className="text-[16px] font-bold">
            Agendar cita
          </h3>
          <p className="mt-1 text-sm text-text-3">
            Con {conversation.contact.name}. Solo se ofrecen horarios libres de tu agenda.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Horario</Label>
          {cargando ? (
            <p className="text-sm text-text-3">Buscando horarios libres…</p>
          ) : huecos === null ? (
            <p className="text-sm text-danger-text">
              No pude leer la agenda. Revisa tu conexión e inténtalo de nuevo.
            </p>
          ) : porDia.length === 0 ? (
            <p className="text-sm text-text-3">
              No hay horarios libres en los próximos días. Revisa Ajustes → Agenda.
            </p>
          ) : (
            <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
              {porDia.map((g) => (
                <div key={g.dayLabel}>
                  <p className="mb-1.5 text-xs font-medium text-text-2">{g.dayLabel}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.huecos.map((h) => (
                      <button
                        key={h.startUtc}
                        type="button"
                        onClick={() => setElegido(h)}
                        aria-pressed={elegido?.startUtc === h.startUtc}
                        className={cn(
                          "rounded-md border px-2.5 py-1 font-mono text-xs transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          elegido?.startUtc === h.startUtc
                            ? "border-brand bg-brand text-white"
                            : "border-input hover:border-text-3"
                        )}
                      >
                        {h.time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agendar-nota">Nota interna (opcional)</Label>
          <Input
            id="agendar-nota"
            value={nota}
            maxLength={200}
            placeholder="Llamada de diagnóstico"
            onChange={(e) => setNota(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={avisar && conversation.windowOpen}
              disabled={!conversation.windowOpen}
              onChange={(e) => setAvisar(e.target.checked)}
            />
            Mandarle la confirmación por WhatsApp
          </label>
          {!conversation.windowOpen && (
            <p className="text-xs text-text-3">
              La ventana de 24 h está cerrada: WhatsApp solo deja enviar plantillas.
              La cita se agenda igual.
            </p>
          )}
          {avisar && conversation.windowOpen && (
            <Textarea
              id="agendar-mensaje"
              aria-label="Mensaje de confirmación"
              rows={3}
              value={mensaje}
              placeholder="Elige un horario para armar el mensaje"
              onChange={(e) => {
                setMensaje(e.target.value);
                setEditado(true);
              }}
            />
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={ocupado || !elegido}>
            {ocupado ? "Agendando…" : "Confirmar cita"}
          </Button>
        </div>
      </form>
    </div>
  );
}
