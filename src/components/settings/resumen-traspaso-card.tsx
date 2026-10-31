"use client";

import { useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ConfigResumen } from "@/lib/resumen-traspaso";

/**
 * Módulo de la agencia (Treviño AI) — Resumen para quien atiende, en Ajustes
 * → IA: el interruptor de encendido/apagado y el aviso opcional al dueño.
 */

type Datos = { config: ConfigResumen; puedeEditar: boolean };

export function ResumenTraspasoCard() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [config, setConfig] = useState<ConfigResumen | null>(null);
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings/resumen-traspaso").catch(() => null);
      if (!res?.ok) return;
      const d = (await res.json()) as Datos;
      setDatos(d);
      setConfig(d.config);
      setTelefono(d.config.telefonoDueno ?? "");
    })();
  }, []);

  if (!datos || !config) return null;
  const editable = datos.puedeEditar;

  async function guardar(nueva: ConfigResumen) {
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/settings/resumen-traspaso", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nueva),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    }
    const d = (await res.json()) as { config: ConfigResumen };
    setConfig(d.config);
    setTelefono(d.config.telefonoDueno ?? "");
    setAviso({ ok: true, texto: "Guardado" });
  }

  const conTelefono = { ...config, telefonoDueno: telefono.trim() || null };

  return (
    <Card className="max-w-2xl" data-resumen-traspaso-card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Hand className="h-4 w-4 text-primary" aria-hidden /> Resumen para quien atiende
            </CardTitle>
            <CardDescription>
              Cuando el agente pasa una conversación a una persona, o alguien pausa la IA, la IA arma
              un resumen corto arriba del chat: quién es, qué quiere, qué ya se le dijo y qué falta.
              Al cliente nunca le llega.
            </CardDescription>
          </div>
          <Switch
            checked={config.activo}
            onCheckedChange={(v) => void guardar({ ...conTelefono, activo: v })}
            label="Armar el resumen para quien atiende"
            disabled={!editable || guardando}
          />
        </div>
      </CardHeader>
      {config.activo && (
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label>Avisarme por WhatsApp</Label>
              <p className="text-xs text-muted-foreground">
                Cuando el agente pasa una conversación, te llega un mensaje corto con el link para
                abrirla. Solo llega si ese teléfono le escribió al número del negocio en las últimas
                24 h; si no, se ve solo en la bandeja.
              </p>
            </div>
            <Switch
              checked={config.avisarDueno}
              onCheckedChange={(v) => {
                setConfig({ ...config, avisarDueno: v });
                setAviso(null);
              }}
              label="Avisarme por WhatsApp"
              disabled={!editable}
            />
          </div>
          {config.avisarDueno && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="resumen-telefono">Teléfono que recibe el aviso (con lada)</Label>
                <Input
                  id="resumen-telefono"
                  inputMode="tel"
                  placeholder="52 81 1234 5678"
                  value={telefono}
                  disabled={!editable}
                  onChange={(e) => {
                    setTelefono(e.target.value);
                    setAviso(null);
                  }}
                  className="w-56"
                />
              </div>
            </div>
          )}
          {editable && (
            <div className="flex items-center gap-3">
              <Button onClick={() => void guardar(conTelefono)} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
              {aviso && (
                <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                  {aviso.texto}
                </span>
              )}
            </div>
          )}
        </CardContent>
      )}
      {!config.activo && aviso && (
        <CardContent>
          <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
            {aviso.ok ? "Apagado: ya no se arman resúmenes" : aviso.texto}
          </span>
        </CardContent>
      )}
    </Card>
  );
}
