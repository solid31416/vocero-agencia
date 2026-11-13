"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DIAS, NOMBRE_DIA, type ConfigEspera, type Dia, type Horario } from "@/lib/espera-humano";

/**
 * Módulo de la agencia (Treviño AI) — «Nadie ha contestado», en Ajustes → IA:
 * el interruptor, el mensaje automático al cliente (y el de fuera de
 * horario), el horario de atención y el aviso al dueño.
 */

type Datos = { config: ConfigEspera; zona: string; puedeEditar: boolean };
type DiaEditable = { abierto: boolean; start: string; end: string };

function aEditable(h: Horario): Record<Dia, DiaEditable> {
  const r = {} as Record<Dia, DiaEditable>;
  for (const d of DIAS) {
    const primero = h[d]?.[0];
    r[d] = primero ? { abierto: true, ...primero } : { abierto: false, start: "09:00", end: "18:00" };
  }
  return r;
}

function aHorario(e: Record<Dia, DiaEditable>): Horario {
  const r: Horario = {};
  for (const d of DIAS) if (e[d].abierto) r[d] = [{ start: e[d].start, end: e[d].end }];
  return r;
}

export function EsperaCard() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [borrador, setBorrador] = useState<ConfigEspera | null>(null);
  const [dias, setDias] = useState<Record<Dia, DiaEditable> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  function adoptar(c: ConfigEspera) {
    setBorrador(c);
    setDias(aEditable(c.horario));
  }

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings/espera").catch(() => null);
      if (!res?.ok) return;
      const d = (await res.json()) as Datos;
      setDatos(d);
      adoptar(d.config);
    })();
  }, []);

  if (!datos || !borrador || !dias) return null;
  const editable = datos.puedeEditar;
  const activo = datos.config.activo;
  const cambiar = (campo: Partial<ConfigEspera>) => setBorrador((b) => (b ? { ...b, ...campo } : b));
  const cambiarDia = (d: Dia, campo: Partial<DiaEditable>) =>
    setDias((x) => (x ? { ...x, [d]: { ...x[d], ...campo } } : x));

  async function guardar(cambios: Partial<ConfigEspera> = {}) {
    if (!borrador || !dias) return;
    setGuardando(true);
    setAviso(null);
    const cuerpo = { ...borrador, horario: aHorario(dias), ...cambios };
    const res = await fetch("/api/settings/espera", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      // «telefonoDueno: Pon el teléfono…» → solo lo que entiende el dueño.
      const texto = d?.error?.message?.split("; ")[0]?.replace(/^[\w.]+: /, "");
      return setAviso({ ok: false, texto: texto || "No se pudo guardar" });
    }
    const d = (await res.json()) as { config: ConfigEspera };
    setDatos({ ...datos!, config: d.config });
    adoptar(d.config);
    setAviso({ ok: true, texto: "Guardado" });
  }

  return (
    <Card className="max-w-2xl" data-espera-card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-primary" aria-hidden /> Nadie ha contestado
            </CardTitle>
            <CardDescription>
              Cuando la IA está en pausa, la bandeja muestra cuánto lleva esperando cada cliente. Si nadie le contesta,
              se le avisa al cliente para que no se quede colgado y a ti por WhatsApp.
            </CardDescription>
          </div>
          <Switch
            checked={activo}
            onCheckedChange={(v) => void guardar({ activo: v })}
            label="Nadie ha contestado encendido"
            disabled={!editable || guardando}
          />
        </div>
      </CardHeader>
      {activo && (
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Mensaje al cliente</p>
                <p className="text-xs text-muted-foreground">
                  Una sola vez por traspaso, si nadie ha escrito. Sale como mensaje automático.
                </p>
              </div>
              <Switch
                checked={borrador.mensajeCliente}
                onCheckedChange={(v) => cambiar({ mensajeCliente: v })}
                label="Mandar mensaje al cliente"
                disabled={!editable}
              />
            </div>
            {borrador.mensajeCliente && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <span>Si nadie contesta en</span>
                  <NumeroInput
                    entero
                    min={1}
                    max={240}
                    value={borrador.minutosCliente}
                    onValueChange={(n) => cambiar({ minutosCliente: Math.round(n) })}
                    disabled={!editable}
                    className="w-20"
                    aria-label="Minutos antes de avisarle al cliente"
                  />
                  <span>minutos</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="espera-texto-cliente">En horario</Label>
                  <Textarea
                    id="espera-texto-cliente"
                    rows={2}
                    maxLength={500}
                    value={borrador.textoCliente}
                    onChange={(e) => cambiar({ textoCliente: e.target.value })}
                    disabled={!editable}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="espera-texto-fuera">Fuera de horario</Label>
                  <Textarea
                    id="espera-texto-fuera"
                    rows={2}
                    maxLength={500}
                    value={borrador.textoFuera}
                    onChange={(e) => cambiar({ textoFuera: e.target.value })}
                    disabled={!editable}
                  />
                  <p className="text-xs text-muted-foreground">
                    {"{apertura}"} se cambia sola por cuándo abren, p. ej. «mañana a las 9:00».
                  </p>
                </div>
              </>
            )}
          </section>

          <section className="space-y-2">
            <div>
              <p className="text-sm font-semibold">Horario de atención</p>
              <p className="text-xs text-muted-foreground">Zona horaria del negocio: {datos.zona}</p>
            </div>
            <ul className="space-y-1.5">
              {DIAS.map((d) => (
                <li key={d} className="flex flex-wrap items-center gap-2 text-sm" data-dia={d}>
                  <label className="flex w-28 cursor-pointer items-center gap-2 capitalize">
                    <input
                      type="checkbox"
                      checked={dias[d].abierto}
                      onChange={(e) => cambiarDia(d, { abierto: e.target.checked })}
                      disabled={!editable}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {NOMBRE_DIA[d]}
                  </label>
                  {dias[d].abierto ? (
                    <>
                      <Input
                        type="time"
                        value={dias[d].start}
                        onChange={(e) => cambiarDia(d, { start: e.target.value })}
                        disabled={!editable}
                        className="w-28"
                        aria-label={`Abre el ${NOMBRE_DIA[d]}`}
                      />
                      <span className="text-muted-foreground">a</span>
                      <Input
                        type="time"
                        value={dias[d].end}
                        onChange={(e) => cambiarDia(d, { end: e.target.value })}
                        disabled={!editable}
                        className="w-28"
                        aria-label={`Cierra el ${NOMBRE_DIA[d]}`}
                      />
                    </>
                  ) : (
                    <span className="text-muted-foreground">Cerrado</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Aviso para ti por WhatsApp</p>
                <p className="text-xs text-muted-foreground">
                  Solo en horario de atención: lo de la noche te llega a la hora de abrir.
                </p>
              </div>
              <Switch
                checked={borrador.avisarDueno}
                onCheckedChange={(v) => cambiar({ avisarDueno: v })}
                label="Avisarme por WhatsApp"
                disabled={!editable}
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span>{borrador.avisarDueno ? "Avísame si alguien lleva" : "En rojo cuando alguien lleva"}</span>
              <NumeroInput
                entero
                min={1}
                max={1440}
                value={borrador.minutosDueno}
                onValueChange={(n) => cambiar({ minutosDueno: Math.round(n) })}
                disabled={!editable}
                className="w-20"
                aria-label="Minutos antes de avisarte"
              />
              <span>minutos esperando</span>
            </div>
            {borrador.avisarDueno && (
              <div className="space-y-1.5">
                <Label htmlFor="espera-telefono">Tu WhatsApp (con lada, p. ej. 52 81 1234 5678)</Label>
                <Input
                  id="espera-telefono"
                  inputMode="tel"
                  value={borrador.telefonoDueno ?? ""}
                  onChange={(e) => cambiar({ telefonoDueno: e.target.value })}
                  disabled={!editable}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Ese número tiene que haberle escrito a tu WhatsApp del negocio en las últimas 24 h para que el aviso
                  pueda llegar.
                </p>
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button size="sm" onClick={() => void guardar()} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
            )}
            {aviso && (
              <span className={aviso.ok ? "text-xs text-muted-foreground" : "text-xs text-danger-text"}>
                {aviso.texto}
              </span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
