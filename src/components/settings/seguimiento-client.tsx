"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  MAX_DIAS,
  MAX_PASOS,
  MIN_DIAS,
  PLANTILLAS_SUGERIDAS,
  armarVariables,
  describirDias,
  type ConfigSeguimiento,
  type EnvioDto,
  type Paso,
} from "@/lib/seguimiento";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Seguimiento.
 *
 * A los cuántos días se le escribe al cliente que dejó de contestar, con qué
 * plantilla aprobada cada vez, en qué etapas no, y lo último que salió.
 */

type Plantilla = { id: string; name: string; language: string; category: string; body: string; variables: number };
type Etapa = { id: string; nombre: string; kind: "open" | "won" | "lost" };
type Datos = {
  config: ConfigSeguimiento;
  plantillas: Plantilla[];
  etapas: Etapa[];
  envios: EnvioDto[];
  puedeEditar: boolean;
};

export const ESTADO_ENVIO: Record<EnvioDto["estado"], { texto: string; clase: string }> = {
  enviado: { texto: "Enviado", clase: "bg-success-tint text-success-text" },
  omitido: { texto: "No se mandó", clase: "bg-warning-tint text-warning-text" },
  fallido: { texto: "Falló", clase: "bg-danger-tint text-danger-text" },
  enviando: { texto: "Enviando", clase: "bg-brand-tint text-brand-text" },
};

/** La plantilla con sus {{n}} ya reemplazados por el ejemplo. */
function vistaPrevia(cuerpo: string, valores: string[]): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => valores[Number(n) - 1] || `{{${n}}}`);
}

export function SeguimientoClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [config, setConfig] = useState<ConfigSeguimiento | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/seguimiento").catch(() => null);
    if (!res?.ok) return setAviso({ ok: false, texto: "No se pudo cargar el seguimiento" });
    const d = (await res.json()) as Datos;
    setDatos(d);
    setConfig(d.config);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || !config) {
    return aviso ? <p className="text-sm text-danger-text">{aviso.texto}</p> : null;
  }
  const editable = datos.puedeEditar;

  function cambiar(parcial: Partial<ConfigSeguimiento>) {
    setConfig((c) => (c ? { ...c, ...parcial } : c));
    setAviso(null);
  }
  function cambiarPaso(i: number, parcial: Partial<Paso>) {
    cambiar({ pasos: config!.pasos.map((p, j) => (j === i ? { ...p, ...parcial } : p)) });
  }
  function agregarPaso() {
    const ultimo = config!.pasos[config!.pasos.length - 1]?.dias ?? 0;
    cambiar({
      pasos: [...config!.pasos, { dias: Math.min(MAX_DIAS, ultimo + 7), plantillaId: null, variables: ["{nombre}"] }],
    });
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/settings/seguimiento", {
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

  const abiertas = datos.etapas.filter((e) => e.kind === "open");
  const cerradas = datos.etapas.filter((e) => e.kind !== "open");

  return (
    <div className="max-w-2xl space-y-6" data-seguimiento>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Seguimiento automático
              </CardTitle>
              <CardDescription>
                Al cliente que dejó de contestar le escribimos solos, a los días que tú digas desde su último
                mensaje. Si vuelve a escribir, la cuenta empieza de nuevo. Solo a quien ya le habían contestado.
              </CardDescription>
            </div>
            <Switch
              checked={config.activo}
              onCheckedChange={(v) => cambiar({ activo: v })}
              label="Hacer seguimiento automático"
              disabled={!editable}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <Label>Pasos</Label>
            {config.pasos.map((p, i) => {
              const plantilla = datos.plantillas.find((t) => t.id === p.plantillaId) ?? null;
              const n = plantilla?.variables ?? 0;
              return (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">Paso {i + 1}:</span>
                    <span className="text-sm text-muted-foreground">a los</span>
                    <Input
                      type="number"
                      min={MIN_DIAS}
                      max={MAX_DIAS}
                      value={p.dias}
                      disabled={!editable}
                      onChange={(e) => cambiarPaso(i, { dias: Math.round(Number(e.target.value) || MIN_DIAS) })}
                      className="w-20"
                      aria-label={`Días del paso ${i + 1}`}
                    />
                    <span className="text-sm text-muted-foreground">días de su último mensaje</span>
                    {editable && config.pasos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => cambiar({ pasos: config.pasos.filter((_, j) => j !== i) })}
                        aria-label={`Quitar el paso ${i + 1}`}
                        className="ml-auto rounded-md p-1 text-text-3 hover:bg-accent hover:text-foreground"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <select
                    value={p.plantillaId ?? ""}
                    disabled={!editable}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      const t = datos.plantillas.find((x) => x.id === id);
                      const vars = Array.from({ length: t?.variables ?? 0 }, (_, k) =>
                        p.variables[k] ?? (k === 0 ? "{nombre}" : "")
                      );
                      cambiarPaso(i, { plantillaId: id, variables: vars });
                    }}
                    aria-label={`Plantilla del paso ${i + 1}`}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Sin plantilla: este paso no se manda</option>
                    {datos.plantillas.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.language} · {t.category})
                      </option>
                    ))}
                  </select>
                  {plantilla &&
                    Array.from({ length: n }, (_, k) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{`{{${k + 1}}}`}</span>
                        <Input
                          value={p.variables[k] ?? ""}
                          disabled={!editable}
                          maxLength={200}
                          onChange={(e) => {
                            const vars = Array.from({ length: n }, (_, j) => p.variables[j] ?? "");
                            vars[k] = e.target.value;
                            cambiarPaso(i, { variables: vars });
                          }}
                          aria-label={`Valor de {{${k + 1}}} del paso ${i + 1}`}
                        />
                      </div>
                    ))}
                  {plantilla && (
                    <p className="rounded-md bg-subtle p-2 text-sm">
                      <span className="text-xs text-muted-foreground">Así se ve: </span>
                      {vistaPrevia(plantilla.body, armarVariables(p.variables.slice(0, n), "Ana López"))}
                    </p>
                  )}
                </div>
              );
            })}
            {editable && config.pasos.length < MAX_PASOS && (
              <Button type="button" variant="outline" size="sm" onClick={agregarPaso}>
                <Plus className="mr-1 h-4 w-4" /> Agregar paso
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Escribe <code>{"{nombre}"}</code> en una variable para poner el nombre del cliente. Un paso que se
              pasó por más de 2 días (por ejemplo, pláticas viejas al encender el módulo) ya no se manda.
            </p>
          </div>

          <div className="space-y-2">
            <Label>¿En qué etapas NO se le escribe?</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {abiertas.map((e) => (
                <label key={e.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={config.excluirEtapas.includes(e.id)}
                    onChange={(ev) =>
                      cambiar({
                        excluirEtapas: ev.target.checked
                          ? [...config.excluirEtapas, e.id]
                          : config.excluirEtapas.filter((x) => x !== e.id),
                      })
                    }
                  />
                  {e.nombre}
                </label>
              ))}
            </div>
            {cerradas.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {cerradas.map((e) => `«${e.nombre}»`).join(" y ")} nunca llevan seguimiento.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Plantillas sugeridas</Label>
            <p className="text-xs text-muted-foreground">
              Pasadas 24 h del último mensaje del cliente, WhatsApp solo deja mandar plantillas aprobadas por
              Meta. Da de alta estas en{" "}
              <Link href="/settings/templates" className="font-medium text-brand-text underline underline-offset-2">
                Plantillas
              </Link>{" "}
              (categoría Marketing: Meta cobra cada una) y elígelas arriba cuando las aprueben. {"{{1}}"} es el
              nombre.
            </p>
            <ol className="list-decimal space-y-1 pl-5 font-mono text-xs">
              {PLANTILLAS_SUGERIDAS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>

          {editable && (
            <div className="flex items-center gap-3">
              <Button onClick={() => void guardar()} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar seguimiento"}
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

      <Card>
        <CardHeader>
          <CardTitle>Últimos seguimientos</CardTitle>
        </CardHeader>
        <CardContent>
          {datos.envios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no sale ninguno.</p>
          ) : (
            <ul className="divide-y text-sm">
              {datos.envios.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ESTADO_ENVIO[e.estado].clase)}>
                    {ESTADO_ENVIO[e.estado].texto}
                  </span>
                  <Link href={`/inbox?conversation=${encodeURIComponent(e.conversationId)}`} className="font-medium hover:underline">
                    {e.contacto || "Cliente"}
                  </Link>
                  <span className="text-muted-foreground">
                    paso de {describirDias(e.dias)} ·{" "}
                    {new Date(e.creadoEn).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  {e.detalle && <span className="w-full text-xs text-muted-foreground">{e.detalle}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
