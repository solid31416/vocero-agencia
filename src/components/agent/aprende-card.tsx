"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, GraduationCap, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  LIMITE_PREGUNTA,
  LIMITE_RESPUESTA,
  type AprendeDto,
  type SugerenciaDto,
} from "@/lib/aprende-traspasos";

/**
 * Módulo de la agencia (Treviño AI) — «El agente aprende de sus traspasos»,
 * en la pantalla Agente: las P/R que propuso la IA a partir de lo que contestó
 * una persona. Se editan y se aprueban (entran al conocimiento) o se descartan.
 * Con la bandera apagada la ruta da 404 y la tarjeta no aparece.
 */

type Datos = AprendeDto & { puedeEditar: boolean };

export function AprendeCard({ onAprobada }: { onAprobada: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/agent/aprende").catch(() => null);
    if (!res?.ok) return;
    setDatos((await res.json()) as Datos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos) return null;
  const editable = datos.puedeEditar;

  async function encender(activo: boolean) {
    const res = await fetch("/api/agent/aprende", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activo }),
    }).catch(() => null);
    if (!res?.ok) setAviso({ ok: false, texto: "No se pudo guardar" });
    void cargar();
  }

  async function buscar() {
    setBuscando(true);
    setAviso(null);
    const res = await fetch("/api/agent/aprende/buscar", { method: "POST" }).catch(() => null);
    setBuscando(false);
    if (!res?.ok) return setAviso({ ok: false, texto: "No se pudo revisar ahora. Intenta de nuevo." });
    const r = (await res.json()) as { analizados: number; sugerencias: number; esperando: number };
    setAviso({
      ok: true,
      texto:
        r.analizados === 0
          ? r.esperando > 0
            ? `Hay ${r.esperando} traspaso(s) esperando a que una persona conteste.`
            : "No hay traspasos nuevos que revisar."
          : `Revisé ${r.analizados} conversación(es): ${r.sugerencias} sugerencia(s) nueva(s).`,
    });
    void cargar();
  }

  return (
    <Card className="lg:col-span-2" data-aprende-card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" aria-hidden /> El agente aprende de sus
              traspasos
              {datos.pendientes.length > 0 && <Badge variant="warning">{datos.pendientes.length}</Badge>}
            </CardTitle>
            <CardDescription>
              Cuando el agente pasa una conversación y una persona la atiende, la IA lee lo que contestó
              la persona y propone preguntas y respuestas para el conocimiento. Nada entra solo: tú las
              revisas y las apruebas.
            </CardDescription>
          </div>
          <Switch
            checked={datos.config.activo}
            onCheckedChange={(v) => void encender(v)}
            label="Proponer lo aprendido de los traspasos"
            disabled={!editable}
          />
        </div>
      </CardHeader>
      {datos.config.activo && (
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {datos.enEspera} en espera · {datos.aprobadas} aprobada(s) · {datos.descartadas} descartada(s)
            </span>
            <Button size="sm" variant="outline" onClick={() => void buscar()} disabled={buscando}>
              <RefreshCw className={buscando ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {buscando ? "Revisando…" : "Buscar ahora"}
            </Button>
          </div>
          {aviso && (
            <p className={aviso.ok ? "text-xs text-muted-foreground" : "text-xs text-danger-text"}>{aviso.texto}</p>
          )}
          {datos.pendientes.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Sin sugerencias por revisar. Aparecen cuando una persona contesta una conversación que el
              agente le pasó (se revisa sola cada 10 minutos, cuando la plática se calma o reactivas la IA).
            </p>
          ) : (
            <ul className="space-y-3">
              {datos.pendientes.map((s) => (
                <Sugerencia
                  key={s.id}
                  s={s}
                  editable={editable}
                  onListo={(aprobada) => {
                    if (aprobada) onAprobada();
                    void cargar();
                  }}
                />
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Sugerencia({
  s,
  editable,
  onListo,
}: {
  s: SugerenciaDto;
  editable: boolean;
  onListo: (aprobada: boolean) => void;
}) {
  const [pregunta, setPregunta] = useState(s.pregunta);
  const [respuesta, setRespuesta] = useState(s.respuesta);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolver(accion: "aprobar" | "descartar") {
    setOcupado(true);
    setError(null);
    const res = await fetch(`/api/agent/aprende/${s.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(accion === "aprobar" ? { accion, pregunta, respuesta } : { accion }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(d?.error?.message ?? "No se pudo guardar");
    }
    onListo(accion === "aprobar");
  }

  const listo = pregunta.trim() && respuesta.trim();

  return (
    <li className="space-y-2 rounded-md border p-3" data-sugerencia={s.id}>
      {s.porque && <p className="text-xs text-muted-foreground">💡 {s.porque}</p>}
      <Input
        value={pregunta}
        maxLength={LIMITE_PREGUNTA}
        onChange={(e) => setPregunta(e.target.value)}
        disabled={!editable || ocupado}
        aria-label="Pregunta"
      />
      <Textarea
        value={respuesta}
        rows={2}
        maxLength={LIMITE_RESPUESTA}
        onChange={(e) => setRespuesta(e.target.value)}
        disabled={!editable || ocupado}
        aria-label="Respuesta"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/inbox?conversation=${s.conversationId}`}
          className="text-xs text-brand-text underline underline-offset-2"
        >
          Ver la conversación{s.nombreContacto ? ` con ${s.nombreContacto}` : ""}
        </Link>
        {editable && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => void resolver("descartar")} disabled={ocupado}>
              <X className="h-4 w-4" /> Descartar
            </Button>
            <Button size="sm" onClick={() => void resolver("aprobar")} disabled={ocupado || !listo}>
              <Check className="h-4 w-4" /> Agregar al conocimiento
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-danger-text">{error}</p>}
    </li>
  );
}
