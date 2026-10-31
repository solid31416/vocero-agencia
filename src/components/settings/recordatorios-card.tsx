"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_AVISO_MIN,
  MAX_AVISOS,
  MAX_TEXTO,
  MIN_AVISO_MIN,
  PLANTILLA_SUGERIDA,
  armarTexto,
  describirAviso,
  type ConfigRecordatorios,
  type EnvioDto,
} from "@/lib/recordatorios";

/**
 * Módulo de la agencia (Treviño AI) — Recordatorios de cita, en Ajustes →
 * Agenda. Cuándo se avisa (uno o varios: días, horas o minutos antes), qué se
 * dice, con qué plantilla si la ventana de 24 h está cerrada, y los últimos
 * avisos que salieron.
 */

type Plantilla = { id: string; name: string; language: string; body: string; variables: number };
type Datos = {
  config: ConfigRecordatorios;
  plantillas: Plantilla[];
  envios: EnvioDto[];
  puedeEditar: boolean;
};

const UNIDADES = [
  { clave: "min", label: "minutos", factor: 1 },
  { clave: "h", label: "horas", factor: 60 },
  { clave: "d", label: "días", factor: 1440 },
] as const;

const EJEMPLO = { nombre: "Ana", fecha: "viernes 6 de noviembre", hora: "10:00 a.m.", enlace: null };

const ESTADO: Record<EnvioDto["estado"], { texto: string; clase: string }> = {
  enviado: { texto: "Enviado", clase: "bg-success-tint text-success-text" },
  omitido: { texto: "No se mandó", clase: "bg-warning-tint text-warning-text" },
  fallido: { texto: "Falló", clase: "bg-danger-tint text-danger-text" },
  enviando: { texto: "Enviando", clase: "bg-brand-tint text-brand-text" },
};

export function RecordatoriosCard() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [config, setConfig] = useState<ConfigRecordatorios | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [unidad, setUnidad] = useState<(typeof UNIDADES)[number]["clave"]>("h");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/recordatorios").catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as Datos;
    setDatos(d);
    setConfig(d.config);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || !config) return null;
  const editable = datos.puedeEditar;

  function cambiar(parcial: Partial<ConfigRecordatorios>) {
    setConfig((c) => (c ? { ...c, ...parcial } : c));
    setAviso(null);
  }

  function agregarAviso() {
    const n = Number(cantidad);
    const factor = UNIDADES.find((u) => u.clave === unidad)!.factor;
    const minutos = Math.round(n * factor);
    if (!Number.isFinite(n) || n <= 0) return setAviso({ ok: false, texto: "Escribe un número mayor que cero" });
    if (minutos < MIN_AVISO_MIN || minutos > MAX_AVISO_MIN) {
      return setAviso({ ok: false, texto: `Entre ${MIN_AVISO_MIN} minutos y 7 días antes` });
    }
    if (config!.avisos.includes(minutos)) return setAviso({ ok: false, texto: "Ese aviso ya está" });
    if (config!.avisos.length >= MAX_AVISOS) {
      return setAviso({ ok: false, texto: `Máximo ${MAX_AVISOS} avisos por cita` });
    }
    cambiar({ avisos: [...config!.avisos, minutos].sort((a, b) => b - a) });
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/settings/recordatorios", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    }
    setAviso({ ok: true, texto: "Guardado" });
    void cargar();
  }

  return (
    <Card className="max-w-2xl" data-recordatorios>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-primary" aria-hidden /> Recordatorios de cita
            </CardTitle>
            <CardDescription>
              Le recordamos la cita al cliente por WhatsApp, cuando tú digas. Solo citas agendadas
              (no las canceladas ni las del Laboratorio).
            </CardDescription>
          </div>
          <Switch
            checked={config.activo}
            onCheckedChange={(v) => cambiar({ activo: v })}
            label="Mandar recordatorios de cita"
            disabled={!editable}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>¿Cuándo se le recuerda?</Label>
          <div className="flex flex-wrap gap-2">
            {config.avisos.length === 0 && (
              <span className="text-sm text-muted-foreground">Sin avisos: agrega al menos uno.</span>
            )}
            {config.avisos.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1 rounded-full border bg-subtle py-1 pl-3 pr-1.5 text-sm"
              >
                {describirAviso(m)}
                {editable && (
                  <button
                    type="button"
                    aria-label={`Quitar ${describirAviso(m)}`}
                    onClick={() => cambiar({ avisos: config.avisos.filter((x) => x !== m) })}
                    className="rounded-full p-0.5 text-text-3 hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {editable && config.avisos.length < MAX_AVISOS && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="w-20"
                aria-label="Cuánto tiempo antes"
              />
              <select
                value={unidad}
                onChange={(e) => setUnidad(e.target.value as typeof unidad)}
                aria-label="Unidad"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {UNIDADES.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.label}
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">antes</span>
              <Button type="button" variant="outline" size="sm" onClick={agregarAviso}>
                Agregar
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recordatorio-texto">Mensaje (si el cliente te escribió en las últimas 24 h)</Label>
          <Textarea
            id="recordatorio-texto"
            rows={3}
            maxLength={MAX_TEXTO}
            value={config.texto}
            disabled={!editable}
            onChange={(e) => cambiar({ texto: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Usa <code>{"{nombre}"}</code>, <code>{"{fecha}"}</code>, <code>{"{hora}"}</code> y{" "}
            <code>{"{enlace}"}</code> (el link de la reunión, si hay).
          </p>
          <p className="rounded-md bg-subtle p-2 text-sm">
            <span className="text-xs text-muted-foreground">Así se ve: </span>
            {armarTexto(config.texto, EJEMPLO)}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recordatorio-plantilla">Plantilla (si pasaron más de 24 h)</Label>
          <select
            id="recordatorio-plantilla"
            value={config.plantillaId ?? ""}
            disabled={!editable}
            onChange={(e) => cambiar({ plantillaId: e.target.value || null })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Sin plantilla: no se manda</option>
            {datos.plantillas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.language})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pasadas 24 h desde el último mensaje del cliente, WhatsApp solo deja mandar plantillas
            aprobadas por Meta. Crea una en{" "}
            <Link href="/settings/templates" className="font-medium text-brand-text underline underline-offset-2">
              Plantillas
            </Link>{" "}
            (categoría Utilidad) con este texto, y elígela aquí cuando Meta la apruebe:
          </p>
          <p className="rounded-md bg-subtle p-2 font-mono text-xs">{PLANTILLA_SUGERIDA}</p>
          <p className="text-xs text-muted-foreground">
            {"{{1}}"} es el nombre, {"{{2}}"} la fecha, {"{{3}}"} la hora y {"{{4}}"} (opcional) el
            enlace.
          </p>
        </div>

        {editable && (
          <div className="flex items-center gap-3">
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar recordatorios"}
            </Button>
            {aviso && (
              <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                {aviso.texto}
              </span>
            )}
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label>Últimos recordatorios</Label>
          {datos.envios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no sale ninguno.</p>
          ) : (
            <ul className="divide-y text-sm">
              {datos.envios.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ESTADO[e.estado].clase)}>
                    {ESTADO[e.estado].texto}
                  </span>
                  <span className="font-medium">{e.contacto || "Cliente"}</span>
                  <span className="text-muted-foreground">
                    cita {new Date(e.cita).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {describirAviso(e.minutos)}
                  </span>
                  {e.detalle && <span className="w-full text-xs text-muted-foreground">{e.detalle}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
