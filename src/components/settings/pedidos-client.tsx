"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Package, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_ETAPAS,
  MAX_MENSAJE,
  MIN_ETAPAS,
  PLANTILLA_SUGERIDA,
  armarMensaje,
  claveDeEtapa,
  type ConfigPedidos,
  type Etapa,
} from "@/lib/pedidos";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Pedidos: las etapas por las
 * que pasa un pedido, qué se le dice al cliente en cada una, y la plantilla
 * para cuando la ventana de 24 h está cerrada.
 */

type Plantilla = { id: string; name: string; language: string; category: string; body: string; variables: number };
type Datos = { config: ConfigPedidos; plantillas: Plantilla[]; puedeEditar: boolean };

const EJEMPLO = {
  contacto: "Ana López",
  folio: "PED-0007",
  fechaEstimada: "2026-12-05",
  concepto: "2 × Domo Estándar",
};

export function PedidosAjustesClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [config, setConfig] = useState<ConfigPedidos | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/pedidos").catch(() => null);
    if (!res?.ok) return setAviso({ ok: false, texto: "No se pudieron cargar los pedidos" });
    const d = (await res.json()) as Datos;
    setDatos(d);
    setConfig(d.config);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || !config) return aviso ? <p className="text-sm text-danger-text">{aviso.texto}</p> : null;
  const editable = datos.puedeEditar;

  function cambiar(parcial: Partial<ConfigPedidos>) {
    setConfig((c) => (c ? { ...c, ...parcial } : c));
    setAviso(null);
  }
  function cambiarEtapa(i: number, parcial: Partial<Etapa>) {
    cambiar({ etapas: config!.etapas.map((e, j) => (j === i ? { ...e, ...parcial } : e)) });
  }
  function mover(i: number, d: -1 | 1) {
    const etapas = [...config!.etapas];
    const j = i + d;
    if (j < 0 || j >= etapas.length) return;
    [etapas[i], etapas[j]] = [etapas[j]!, etapas[i]!];
    cambiar({ etapas });
  }
  function agregar() {
    const nombre = "Etapa nueva";
    cambiar({
      etapas: [
        ...config!.etapas,
        { id: claveDeEtapa(nombre, config!.etapas.map((e) => e.id)), nombre, mensaje: "" },
      ],
    });
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/settings/pedidos", {
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
    <Card className="max-w-2xl" data-pedidos-ajustes>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" aria-hidden /> Pedidos
        </CardTitle>
        <CardDescription>
          Las etapas por las que pasa un pedido y lo que se le dice al cliente en cada una. Los pedidos se crean
          desde la bandeja y se siguen en{" "}
          <Link href="/pedidos" className="font-medium text-brand-text underline underline-offset-2">
            Pedidos
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <Label>Etapas, en orden</Label>
          {config.etapas.map((e, i) => (
            <div key={e.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <span className="w-5 text-sm font-medium text-text-3">{i + 1}.</span>
                <Input
                  value={e.nombre}
                  maxLength={40}
                  disabled={!editable}
                  onChange={(ev) => cambiarEtapa(i, { nombre: ev.target.value })}
                  aria-label={`Nombre de la etapa ${i + 1}`}
                />
                {editable && (
                  <>
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      aria-label="Subir"
                      className="rounded-md p-1 text-text-3 hover:bg-accent disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === config.etapas.length - 1}
                      aria-label="Bajar"
                      className="rounded-md p-1 text-text-3 hover:bg-accent disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => cambiar({ etapas: config.etapas.filter((_, j) => j !== i) })}
                      disabled={config.etapas.length <= MIN_ETAPAS}
                      aria-label={`Quitar la etapa ${e.nombre}`}
                      className="rounded-md p-1 text-text-3 hover:bg-accent disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
              <Textarea
                rows={2}
                maxLength={MAX_MENSAJE}
                value={e.mensaje}
                disabled={!editable}
                onChange={(ev) => cambiarEtapa(i, { mensaje: ev.target.value })}
                placeholder="Sin mensaje: en esta etapa no se le avisa al cliente"
                aria-label={`Mensaje de la etapa ${e.nombre}`}
              />
              {e.mensaje.trim() && (
                <p className="rounded-md bg-subtle p-2 text-sm">
                  <span className="text-xs text-muted-foreground">Así se ve: </span>
                  {armarMensaje(e.mensaje, { ...EJEMPLO, estado: e.nombre })}
                </p>
              )}
            </div>
          ))}
          {editable && config.etapas.length < MAX_ETAPAS && (
            <Button type="button" variant="outline" size="sm" onClick={agregar}>
              <Plus className="mr-1 h-4 w-4" /> Agregar etapa
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            En los mensajes puedes usar <code>{"{nombre}"}</code>, <code>{"{folio}"}</code>,{" "}
            <code>{"{estado}"}</code>, <code>{"{fecha}"}</code> (entrega estimada) y <code>{"{concepto}"}</code>.
            Quien mueve el pedido puede editar el texto antes de que salga.
          </p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label>Anotar el estado en la ficha del cliente</Label>
            <p className="text-xs text-muted-foreground">
              El agente lee la ficha: si el cliente pregunta «¿cómo va mi pedido?», ya sabe qué contestar.
            </p>
          </div>
          <Switch
            checked={config.actualizarFicha}
            onCheckedChange={(v) => cambiar({ actualizarFicha: v })}
            label="Anotar el estado en la ficha"
            disabled={!editable}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pedidos-plantilla">Plantilla (si pasaron más de 24 h)</Label>
          <select
            id="pedidos-plantilla"
            value={config.plantillaId ?? ""}
            disabled={!editable}
            onChange={(e) => cambiar({ plantillaId: e.target.value || null })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Sin plantilla: con la ventana cerrada no se avisa</option>
            {datos.plantillas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.language} · {p.category})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pasadas 24 h desde el último mensaje del cliente, WhatsApp solo deja mandar plantillas aprobadas.
            Crea una en{" "}
            <Link href="/settings/templates" className="font-medium text-brand-text underline underline-offset-2">
              Plantillas
            </Link>{" "}
            (categoría Utilidad) con este texto: {"{{1}}"} nombre, {"{{2}}"} folio, {"{{3}}"} etapa.
          </p>
          <p className="rounded-md bg-subtle p-2 font-mono text-xs">{PLANTILLA_SUGERIDA}</p>
        </div>

        {editable && (
          <div className="flex items-center gap-3">
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar pedidos"}
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
