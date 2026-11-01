"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, RotateCcw, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationDto } from "@/lib/types";
import {
  COLORES,
  MAX_ETIQUETAS_POR_CONVERSACION,
  TEMPERATURAS,
  TEMPERATURA_INFO,
  type Etiqueta,
  type MapaTermometro,
  type Temperatura,
  type TermometroDto,
} from "@/lib/termometro";

/**
 * Módulo de la agencia (Treviño AI) — Termómetro del cliente en la bandeja:
 * las marcas de cada conversación, el filtro y el editor arriba del chat.
 * Sin la bandera (404) o apagado en Ajustes → IA, no se dibuja nada.
 */

const EVENTO = "termometro:cambio";

/** Avisa a la lista que algo cambió (una corrección a mano). */
export function avisarCambioTermometro() {
  window.dispatchEvent(new Event(EVENTO));
}

/** El mapa de temperaturas y etiquetas. Se refresca cuando cambia la bandeja, con un aviso o cada minuto. */
export function useTermometro(senal?: unknown): MapaTermometro | null {
  const [datos, setDatos] = useState<MapaTermometro | null>(null);
  const cargar = useCallback(async () => {
    const res = await fetch("/api/termometro").catch(() => null);
    if (!res?.ok) return setDatos(null);
    setDatos((await res.json()) as MapaTermometro);
  }, []);
  useEffect(() => {
    void cargar();
    const id = setInterval(() => void cargar(), 60_000);
    const alAviso = () => void cargar();
    window.addEventListener(EVENTO, alAviso);
    return () => {
      clearInterval(id);
      window.removeEventListener(EVENTO, alAviso);
    };
  }, [cargar]);
  // La bandeja se vuelve a pedir con cada evento del servidor (también cuando la IA clasifica).
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    const t = setTimeout(() => void cargar(), 800);
    return () => clearTimeout(t);
  }, [senal, cargar]);
  return datos?.activo ? datos : null;
}

export function ChipTemperatura({ temperatura, chico }: { temperatura: Temperatura; chico?: boolean }) {
  const info = TEMPERATURA_INFO[temperatura];
  return (
    <span
      data-temperatura={temperatura}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-semibold",
        chico ? "text-[11px]" : "text-[12px]"
      )}
      style={{ color: info.color, borderColor: `${info.color}55`, background: `${info.color}14` }}
    >
      <span aria-hidden>{info.emoji}</span>
      {info.etiqueta}
    </span>
  );
}

export function ChipEtiqueta({ etiqueta, chico }: { etiqueta: Etiqueta; chico?: boolean }) {
  const color = COLORES[etiqueta.color] ?? COLORES.gris;
  return (
    <span
      data-etiqueta={etiqueta.id}
      title={etiqueta.descripcion || undefined}
      className={cn(
        "inline-flex max-w-[140px] shrink-0 items-center truncate rounded-full border px-2 py-0.5 font-medium",
        chico ? "text-[11px]" : "text-[12px]"
      )}
      style={{ color, borderColor: `${color}55`, background: `${color}12` }}
    >
      {etiqueta.nombre}
    </span>
  );
}

/** Las marcas de una conversación en la lista. */
export function ChipsTermometro({ dto, etiquetas }: { dto: TermometroDto | undefined; etiquetas: Etiqueta[] }) {
  if (!dto) return null;
  const suyas = dto.etiquetas
    .map((id) => etiquetas.find((e) => e.id === id))
    .filter((e): e is Etiqueta => Boolean(e));
  if (!dto.temperatura && suyas.length === 0) return null;
  return (
    <>
      {dto.temperatura && <ChipTemperatura temperatura={dto.temperatura} chico />}
      {suyas.map((e) => (
        <ChipEtiqueta key={e.id} etiqueta={e} chico />
      ))}
    </>
  );
}

/** Arriba del chat: la temperatura y las etiquetas, con «Cambiar» para corregirlas a mano. */
export function TermometroBarra({ conversation }: { conversation: ConversationDto }) {
  const datos = useTermometro(conversation.lastMessageAt);
  const [editando, setEditando] = useState(false);
  const [temp, setTemp] = useState<Temperatura | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = conversation.id;

  useEffect(() => {
    setEditando(false);
    setError(null);
  }, [id]);

  if (!datos) return null;
  const dto = datos.conversaciones[id];

  function abrir() {
    setTemp(dto?.temperatura ?? null);
    setMarcadas(dto?.etiquetas ?? []);
    setError(null);
    setEditando(true);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const res = await fetch(`/api/conversations/${id}/termometro`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temperatura: temp, etiquetas: marcadas }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) return setError("No se pudo guardar");
    setEditando(false);
    avisarCambioTermometro();
  }

  async function automatico() {
    setGuardando(true);
    await fetch(`/api/conversations/${id}/termometro`, { method: "DELETE" }).catch(() => null);
    setGuardando(false);
    setEditando(false);
    avisarCambioTermometro();
  }

  function alternar(etId: string) {
    setMarcadas((m) =>
      m.includes(etId) ? m.filter((x) => x !== etId) : m.length >= MAX_ETIQUETAS_POR_CONVERSACION ? m : [...m, etId]
    );
  }

  const suyas = (dto?.etiquetas ?? [])
    .map((x) => datos.etiquetas.find((e) => e.id === x))
    .filter((e): e is Etiqueta => Boolean(e));

  return (
    <div className="border-b bg-background px-4 py-2 text-[12.5px]" data-termometro-barra>
      {!editando ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Thermometer className="h-3.5 w-3.5 text-text-3" aria-hidden />
          {dto?.temperatura ? (
            <ChipTemperatura temperatura={dto.temperatura} />
          ) : (
            <span className="text-text-3">{dto ? "Sin temperatura" : "Aún sin clasificar"}</span>
          )}
          {suyas.map((e) => (
            <ChipEtiqueta key={e.id} etiqueta={e} />
          ))}
          {dto?.razon && (
            <span className="min-w-0 truncate text-text-3" title={dto.razon}>
              · {dto.manual ? "Puesto a mano" : dto.razon}
            </span>
          )}
          <button
            type="button"
            onClick={abrir}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-brand-text hover:bg-subtle"
          >
            <Pencil className="h-3 w-3" /> Cambiar
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="kicker mr-1 text-text-3">Temperatura</span>
            {TEMPERATURAS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTemp(temp === t ? null : t)}
                aria-pressed={temp === t}
                className={cn("rounded-full", temp === t ? "ring-2 ring-brand" : "opacity-60 hover:opacity-100")}
              >
                <ChipTemperatura temperatura={t} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="kicker mr-1 text-text-3">Etiquetas</span>
            {datos.etiquetas.length === 0 && <span className="text-text-3">Crea etiquetas en Ajustes → IA</span>}
            {datos.etiquetas.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => alternar(e.id)}
                aria-pressed={marcadas.includes(e.id)}
                className={cn(
                  "rounded-full",
                  marcadas.includes(e.id) ? "ring-2 ring-brand" : "opacity-60 hover:opacity-100"
                )}
              >
                <ChipEtiqueta etiqueta={e} />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando}
              className="rounded-md bg-brand px-2.5 py-1 font-semibold text-brand-fg disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditando(false)}
              className="rounded-md px-2 py-1 text-text-2 hover:bg-subtle"
            >
              Cancelar
            </button>
            {dto?.manual && (
              <button
                type="button"
                onClick={() => void automatico()}
                disabled={guardando}
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-text-2 hover:bg-subtle"
              >
                <RotateCcw className="h-3 w-3" /> Que lo decida la IA
              </button>
            )}
            <span className="text-[11.5px] text-text-3">
              Máx. {MAX_ETIQUETAS_POR_CONVERSACION} etiquetas. Lo que pongas a mano, la IA ya no lo cambia.
            </span>
          </div>
          {error && <p className="text-danger-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
