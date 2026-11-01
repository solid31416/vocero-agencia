"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Thermometer, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  COLORES,
  MAX_ETIQUETAS,
  NOMBRES_COLORES,
  TEMPERATURAS,
  TEMPERATURA_INFO,
  type Color,
  type ConfigTermometro,
  type Etiqueta,
} from "@/lib/termometro";

/**
 * Módulo de la agencia (Treviño AI) — Termómetro del cliente, en Ajustes → IA:
 * el interruptor, qué es un cliente «caliente» para el negocio y las
 * etiquetas personalizadas (nombre, cuándo ponerla y color).
 */

type Datos = { config: ConfigTermometro; puedeEditar: boolean };
type EtiquetaEditable = Omit<Etiqueta, "id"> & { llave: string };

let contador = 0;
const llave = () => `e${++contador}`;

export function TermometroCard() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [criterio, setCriterio] = useState("");
  const [etiquetas, setEtiquetas] = useState<EtiquetaEditable[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [clasificando, setClasificando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  function adoptar(c: ConfigTermometro) {
    setCriterio(c.criterio);
    setEtiquetas(c.etiquetas.map((e) => ({ nombre: e.nombre, descripcion: e.descripcion, color: e.color, llave: llave() })));
  }

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings/termometro").catch(() => null);
      if (!res?.ok) return;
      const d = (await res.json()) as Datos;
      setDatos(d);
      adoptar(d.config);
    })();
  }, []);

  if (!datos) return null;
  const editable = datos.puedeEditar;
  const activo = datos.config.activo;

  async function guardar(cambios: Partial<ConfigTermometro> = {}) {
    setGuardando(true);
    setAviso(null);
    const cuerpo = {
      activo,
      criterio,
      etiquetas: etiquetas.map(({ nombre, descripcion, color }) => ({ nombre, descripcion, color })),
      ...cambios,
    };
    const res = await fetch("/api/settings/termometro", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    }
    const d = (await res.json()) as { config: ConfigTermometro };
    setDatos({ ...datos!, config: d.config });
    adoptar(d.config);
    setAviso({ ok: true, texto: "Guardado" });
  }

  async function clasificarAhora() {
    setClasificando(true);
    setAviso(null);
    const res = await fetch("/api/settings/termometro/clasificar", { method: "POST" }).catch(() => null);
    setClasificando(false);
    if (!res?.ok) return setAviso({ ok: false, texto: "No se pudo clasificar ahora" });
    const r = (await res.json()) as { clasificadas: number; errores: number; sinIa: boolean };
    setAviso(
      r.sinIa
        ? { ok: false, texto: "Falta configurar la IA arriba en esta misma página." }
        : {
            ok: true,
            texto:
              r.clasificadas === 0
                ? "No hay conversaciones nuevas que clasificar."
                : `Listo: ${r.clasificadas} conversación(es) clasificada(s)${r.errores ? `, ${r.errores} con error` : ""}.`,
          }
    );
  }

  function cambiar(k: string, campo: Partial<EtiquetaEditable>) {
    setEtiquetas((es) => es.map((e) => (e.llave === k ? { ...e, ...campo } : e)));
  }

  const nombresVacios = etiquetas.some((e) => !e.nombre.trim());

  return (
    <Card className="max-w-2xl" data-termometro-card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-primary" aria-hidden /> Termómetro del cliente
            </CardTitle>
            <CardDescription>
              La IA lee cada conversación cuando se calma y le pone temperatura (
              {TEMPERATURAS.map((t) => `${TEMPERATURA_INFO[t].emoji} ${TEMPERATURA_INFO[t].etiqueta.toLowerCase()}`).join(
                ", "
              )}
              ) y hasta 3 etiquetas tuyas. En la bandeja las ves en cada conversación y filtras con «Filtrar».
            </CardDescription>
          </div>
          <Switch
            checked={activo}
            onCheckedChange={(v) => void guardar({ activo: v })}
            label="Termómetro del cliente encendido"
            disabled={!editable || guardando}
          />
        </div>
      </CardHeader>
      {activo && (
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="termometro-criterio">Para tu negocio, ¿qué es un cliente caliente? (opcional)</Label>
            <Textarea
              id="termometro-criterio"
              rows={2}
              maxLength={500}
              placeholder="Ej.: pidió cotización con medidas, preguntó por fechas o quiere apartar."
              value={criterio}
              onChange={(e) => setCriterio(e.target.value)}
              disabled={!editable}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Etiquetas</Label>
              <span className="text-xs text-muted-foreground">
                {etiquetas.length} de {MAX_ETIQUETAS}
              </span>
            </div>
            <ul className="space-y-2">
              {etiquetas.map((e) => (
                <li key={e.llave} className="space-y-1.5 rounded-md border p-2.5" data-etiqueta-editor>
                  <div className="flex items-center gap-2">
                    <Input
                      value={e.nombre}
                      maxLength={30}
                      placeholder="Nombre (p. ej. Mayoreo)"
                      onChange={(ev) => cambiar(e.llave, { nombre: ev.target.value })}
                      disabled={!editable}
                      aria-label="Nombre de la etiqueta"
                      className="flex-1"
                      style={{ color: COLORES[e.color] }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar etiqueta ${e.nombre}`}
                      onClick={() => setEtiquetas((es) => es.filter((x) => x.llave !== e.llave))}
                      disabled={!editable}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    value={e.descripcion}
                    maxLength={200}
                    placeholder="¿Cuándo ponerla? (la IA lo lee) p. ej. compra 10 piezas o más"
                    onChange={(ev) => cambiar(e.llave, { descripcion: ev.target.value })}
                    disabled={!editable}
                    aria-label="Cuándo poner la etiqueta"
                  />
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
                    {NOMBRES_COLORES.map((c: Color) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={e.color === c}
                        aria-label={c}
                        title={c}
                        onClick={() => cambiar(e.llave, { color: c })}
                        disabled={!editable}
                        className={cn(
                          "h-5 w-5 rounded-full border-2",
                          e.color === c ? "border-foreground" : "border-transparent"
                        )}
                        style={{ background: COLORES[c] }}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {editable && etiquetas.length < MAX_ETIQUETAS && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEtiquetas((es) => [...es, { nombre: "", descripcion: "", color: "azul", llave: llave() }])
                }
              >
                <Plus className="h-4 w-4" /> Agregar etiqueta
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button size="sm" onClick={() => void guardar()} disabled={guardando || nombresVacios}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void clasificarAhora()} disabled={clasificando}>
              <RefreshCw className={clasificando ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {clasificando ? "Clasificando…" : "Clasificar ahora"}
            </Button>
            {aviso && (
              <span className={aviso.ok ? "text-xs text-muted-foreground" : "text-xs text-danger-text"}>
                {aviso.texto}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Se clasifica sola unos 2 minutos después de que se calma cada plática (solo las de los últimos 7 días).
            Si cambias una etiqueta de nombre, las conversaciones que ya la tenían la pierden hasta la siguiente
            clasificación. Lo que alguien corrige a mano en la bandeja, la IA ya no lo cambia.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
