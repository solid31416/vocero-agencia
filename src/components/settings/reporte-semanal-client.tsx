"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DIAS_SEMANA, PLANTILLA_REPORTE_SUGERIDA, type ConfigReporte } from "@/lib/reporte-semanal";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Reporte semanal: a quién,
 * qué día y a qué hora le llega al dueño el resumen de la semana, la
 * plantilla para cuando su ventana de 24 h está cerrada, y cómo saldría hoy.
 */

type Plantilla = { id: string; name: string; language: string; category: string; variables: number };
type Datos = {
  config: ConfigReporte;
  ultimo: { para: string; en: string; detalle: string | null } | null;
  vistaPrevia: string;
  plantillas: Plantilla[];
  puedeEditar: boolean;
};

export function ReporteSemanalClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [config, setConfig] = useState<ConfigReporte | null>(null);
  const [telefono, setTelefono] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "guardar" | "enviar">(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/reporte").catch(() => null);
    if (!res?.ok) return setError("No se pudo cargar el reporte");
    const d = (await res.json()) as Datos;
    setDatos(d);
    setConfig(d.config);
    setTelefono(d.config.telefonoDueno ?? "");
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <p className="text-sm text-danger-text">{error}</p>;
  if (!datos || !config) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const editable = datos.puedeEditar;
  const cambiar = (p: Partial<ConfigReporte>) => setConfig({ ...config, ...p });

  async function guardar() {
    setOcupado("guardar");
    setAviso(null);
    const res = await fetch("/api/settings/reporte", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, telefonoDueno: telefono.trim() || null }),
    }).catch(() => null);
    setOcupado(null);
    const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res?.ok) return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    setAviso({ ok: true, texto: "Guardado" });
    void cargar();
  }

  async function enviar() {
    setOcupado("enviar");
    setAviso(null);
    const res = await fetch("/api/settings/reporte/enviar", { method: "POST" }).catch(() => null);
    setOcupado(null);
    const d = (await res?.json().catch(() => null)) as { detalle?: string; error?: { message?: string } } | null;
    setAviso(
      res?.ok
        ? { ok: true, texto: d?.detalle ?? "Enviado" }
        : { ok: false, texto: d?.error?.message ?? "No se pudo mandar" }
    );
  }

  return (
    <Card className="max-w-3xl" data-reporte-semanal>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden /> Reporte semanal
        </CardTitle>
        <CardDescription>
          Cada semana le llega al dueño por WhatsApp cómo le fue: clientes nuevos, los modelos más preguntados,
          cotizaciones enviadas y cerradas, lo cobrado y lo que falta por cobrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3">
          <Switch checked={config.activo} onCheckedChange={(v) => cambiar({ activo: v })}
            label="Mandar el reporte semanal" disabled={!editable} />
          <span className="text-sm font-medium">Mandar el reporte semanal</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="rep-tel">Teléfono del dueño (con lada)</Label>
            <Input id="rep-tel" inputMode="tel" value={telefono} disabled={!editable} placeholder="5281…"
              onChange={(e) => setTelefono(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Tiene que haberle escrito alguna vez al número de WhatsApp del negocio.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-dia">Día</Label>
            <select id="rep-dia" value={config.dia} disabled={!editable}
              onChange={(e) => cambiar({ dia: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {DIAS_SEMANA.map((d, i) => (
                <option key={d} value={i}>
                  {d[0]!.toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-hora">Hora</Label>
            <select id="rep-hora" value={config.hora} disabled={!editable}
              onChange={(e) => cambiar({ hora: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {Array.from({ length: 16 }, (_, i) => i + 6).map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rep-plantilla">Plantilla (si el dueño no ha escrito en 24 h)</Label>
          <select id="rep-plantilla" value={config.plantillaId ?? ""} disabled={!editable}
            onChange={(e) => cambiar({ plantillaId: e.target.value || null })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Sin plantilla: solo sale si el dueño escribió en las últimas 24 h</option>
            {datos.plantillas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.language} · {p.category})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Lo normal es que el dueño no le escriba a su propio número, así que casi siempre sale con plantilla. Da de
            alta una en{" "}
            <Link href="/settings/templates" className="font-medium text-brand-text underline underline-offset-2">
              Plantillas
            </Link>{" "}
            (categoría Utilidad) con este texto: {"{{1}}"} semana, {"{{2}}"} clientes nuevos, {"{{3}}"} cotizaciones,{" "}
            {"{{4}}"} cerradas, {"{{5}}"} cobrado, {"{{6}}"} por cobrar.
          </p>
          <p className="rounded-md bg-subtle p-2 font-mono text-xs">{PLANTILLA_REPORTE_SUGERIDA}</p>
        </div>

        <div className="space-y-1.5">
          <Label>Así saldría hoy (con la ventana abierta)</Label>
          <pre className="whitespace-pre-wrap rounded-md bg-subtle p-3 font-sans text-sm" data-vista-reporte>
            {datos.vistaPrevia}
          </pre>
          {datos.ultimo && (
            <p className="text-xs text-text-3">
              Último: {new Date(datos.ultimo.en).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              {datos.ultimo.detalle ? ` · ${datos.ultimo.detalle}` : ""}
            </p>
          )}
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button onClick={() => void guardar()} disabled={ocupado !== null}>
              {ocupado === "guardar" ? "Guardando…" : "Guardar"}
            </Button>
            <Button variant="outline" onClick={() => void enviar()}
              disabled={ocupado !== null || !datos.config.telefonoDueno}>
              {ocupado === "enviar" ? "Mandando…" : "Mandármelo ahora"}
            </Button>
            {aviso && (
              <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                {aviso.texto}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
