"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizarAtajo,
  RESPUESTAS_DE_ARRANQUE,
  TEXTO_MAX,
  VARIABLES_DE_VENTA,
  type RespuestaRapida,
} from "@/lib/respuestas-rapidas";

/**
 * 049 — Ajustes → Respuestas rápidas. Las crea y edita quien configura; las
 * usa todo el equipo escribiendo `/atajo` en el compositor de la Bandeja.
 */
export function QuickRepliesClient() {
  const [lista, setLista] = useState<RespuestaRapida[] | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  // `null` = cerrado; `""` = creando una nueva; un id = editando esa.
  const [editando, setEditando] = useState<string | null>(null);
  const [atajo, setAtajo] = useState("");
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/quick-replies").catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as { respuestas: RespuestaRapida[]; puedeEditar: boolean };
    setLista(d.respuestas);
    setPuedeEditar(d.puedeEditar);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function abrir(r: RespuestaRapida | null) {
    setEditando(r?.id ?? "");
    setAtajo(r?.atajo ?? "");
    setTexto(r?.texto ?? "");
    setError(null);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const nueva = editando === "";
    const res = await fetch(nueva ? "/api/quick-replies" : `/api/quick-replies/${editando}`, {
      method: nueva ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atajo, texto }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(d?.error?.message ?? "No se pudo guardar. Revisa la conexión.");
      return;
    }
    setEditando(null);
    void cargar();
  }

  async function borrar(r: RespuestaRapida) {
    if (!window.confirm(`¿Borrar la respuesta /${r.atajo}?`)) return;
    const res = await fetch(`/api/quick-replies/${r.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) void cargar();
  }

  const atajoFinal = normalizarAtajo(atajo);

  // Módulo de la agencia: las respuestas de arranque que todavía no existen.
  const faltan = RESPUESTAS_DE_ARRANQUE.filter((e) => !(lista ?? []).some((r) => r.atajo === e.atajo));
  const [cargando, setCargando] = useState(false);
  async function cargarEjemplos() {
    setCargando(true);
    setError(null);
    let fallidas = 0;
    for (const e of faltan) {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(e),
      }).catch(() => null);
      if (!res?.ok) fallidas++;
    }
    setCargando(false);
    if (fallidas > 0) setError(`No se pudieron agregar ${fallidas} de los ejemplos.`);
    void cargar();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Respuestas rápidas</CardTitle>
          <CardDescription>
            Lo que escribes treinta veces al día. En la Bandeja, escribe{" "}
            <span className="font-mono">/</span> y el atajo (por ejemplo{" "}
            <span className="font-mono">/horario</span>) y elige la respuesta: se
            pone en la caja y la revisas antes de mandarla.{" "}
            <span className="font-mono">{"{nombre}"}</span> se cambia por el primer
            nombre del cliente. Solo dentro de la ventana de 24 h: para reabrirla
            están las plantillas.
            <span className="mt-2 block">
              También se llenan solas con lo de la venta de ese cliente:{" "}
              {VARIABLES_DE_VENTA.map((v, i) => (
                <span key={v.clave}>
                  {i > 0 && ", "}
                  <span className="font-mono">{`{${v.clave}}`}</span> ({v.que})
                </span>
              ))}
              . Si el dato no existe, la variable se queda escrita para que la completes.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {lista === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : lista.length === 0 && editando === null ? (
            <p className="text-sm text-text-2">Aún no hay respuestas rápidas.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {lista.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] font-semibold">/{r.atajo}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-text-2">{r.texto}</p>
                  </div>
                  {puedeEditar && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Editar /${r.atajo}`} onClick={() => abrir(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Borrar /${r.atajo}`} onClick={() => void borrar(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {puedeEditar && editando === null && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => abrir(null)}>
                <Plus className="h-4 w-4" /> Nueva respuesta
              </Button>
              {lista !== null && faltan.length > 0 && (
                <Button variant="outline" size="sm" disabled={cargando} onClick={() => void cargarEjemplos()}>
                  <Sparkles className="h-4 w-4" />{" "}
                  {cargando ? "Agregando…" : `Cargar ${faltan.length} de ejemplo`}
                </Button>
              )}
            </div>
          )}
          {puedeEditar && lista !== null && faltan.length > 0 && editando === null && (
            <p className="text-xs text-text-3">
              Ejemplos: /{faltan.map((e) => e.atajo).join(", /")}. Después cambia lo que dice [X] por tus datos.
            </p>
          )}
          {error && editando === null && <p className="text-sm text-danger-text">{error}</p>}

          {editando !== null && (
            <div className="space-y-3 rounded-md border bg-subtle p-3" data-testid="form-respuesta">
              <div className="space-y-1.5">
                <Label htmlFor="qr-atajo">Atajo</Label>
                <Input
                  id="qr-atajo"
                  value={atajo}
                  onChange={(e) => setAtajo(e.target.value)}
                  placeholder="horario"
                  maxLength={40}
                  autoFocus
                />
                <p className="text-xs text-text-3">
                  Se escribe como <span className="font-mono">/{atajoFinal || "atajo"}</span>: letras,
                  números, - o _, sin espacios.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qr-texto">Texto</Label>
                <Textarea
                  id="qr-texto"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={4}
                  maxLength={TEXTO_MAX}
                  placeholder="Abrimos de lunes a sábado de 8:00 a 19:00."
                />
              </div>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" disabled={guardando || !atajoFinal || !texto.trim()} onClick={() => void guardar()}>
                  {guardando ? "Guardando…" : "Guardar"}
                </Button>
                <Button size="sm" variant="outline" disabled={guardando} onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
