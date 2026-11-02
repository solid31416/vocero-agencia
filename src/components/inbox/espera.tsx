"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { duracion, type EsperaDto, type MapaEspera } from "@/lib/espera-humano";

/**
 * Módulo de la agencia (Treviño AI) — «Nadie ha contestado» en la bandeja:
 * cuánto lleva esperando cada cliente a una persona (amarillo, y rojo al
 * pasar el tiempo del aviso al dueño), el filtro y la barra arriba del chat.
 * Sin la bandera (404) o apagado en Ajustes → IA, no se dibuja nada.
 */

const AMARILLO = "#b45309";
const ROJO = "#dc2626";

/** Las esperas. Se refrescan cuando cambia la bandeja y cada minuto. */
export function useEspera(senal?: unknown): MapaEspera | null {
  const [datos, setDatos] = useState<MapaEspera | null>(null);
  const cargar = useCallback(async () => {
    const res = await fetch("/api/espera").catch(() => null);
    if (!res?.ok) return setDatos(null);
    setDatos((await res.json()) as MapaEspera);
  }, []);
  useEffect(() => {
    void cargar();
    const id = setInterval(() => void cargar(), 60_000);
    return () => clearInterval(id);
  }, [cargar]);
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

/** La hora de ahora, que avanza sola para que los minutos corran en pantalla. */
export function useAhora(cadaMs = 30_000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}

function colorDe(dto: EsperaDto, minutosDueno: number, ahora: number): string {
  return ahora - new Date(dto.desde).getTime() >= minutosDueno * 60_000 ? ROJO : AMARILLO;
}

export function ChipEspera({ dto, minutosDueno, ahora }: { dto: EsperaDto | undefined; minutosDueno: number; ahora: number }) {
  if (!dto) return null;
  const color = colorDe(dto, minutosDueno, ahora);
  return (
    <span
      data-espera
      title="Esperando a una persona"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      <Timer className="h-3 w-3" aria-hidden />
      {duracion(ahora - new Date(dto.desde).getTime())}
    </span>
  );
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

/** Arriba del chat: desde cuándo espera y qué avisos ya salieron. */
export function EsperaBarra({ conversation }: { conversation: ConversationDto }) {
  const datos = useEspera(`${conversation.lastMessageAt}|${conversation.aiEnabled}|${conversation.handoffAt}`);
  const ahora = useAhora();
  const dto = datos?.conversaciones[conversation.id];
  if (!datos || !dto) return null;
  const color = colorDe(dto, datos.minutosDueno, ahora);
  const avisos = [
    dto.avisoClienteEn ? `al cliente se le avisó a las ${hora(dto.avisoClienteEn)}` : null,
    dto.avisoDuenoEn ? `al dueño a las ${hora(dto.avisoDuenoEn)}` : null,
  ].filter(Boolean);
  return (
    <div
      data-espera-barra
      className="flex flex-wrap items-center gap-1.5 border-b bg-background px-4 py-1.5 text-[12.5px]"
      style={{ color }}
    >
      <Timer className="h-3.5 w-3.5" aria-hidden />
      <span className="font-semibold">
        {dto.caso === "traspaso" ? "Esperando a una persona" : "Sin respuesta"} hace{" "}
        {duracion(ahora - new Date(dto.desde).getTime())}
      </span>
      {avisos.length > 0 && <span className="text-text-3">· {avisos.join(" · ")}</span>}
    </div>
  );
}
