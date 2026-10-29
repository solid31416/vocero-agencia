"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CLAVES_TIPO,
  MAX_LINEAS,
  MAX_NOMBRE,
  MAX_QUIENES,
  MAX_TIPO_NEGOCIO,
  TIPOS_CLIENTE,
  type ClienteDto,
  type NegocioDto,
  type TipoCliente,
} from "@/lib/lab-a-la-medida";

/**
 * Módulo de la agencia (Treviño AI) — Clientes de prueba a la medida.
 *
 * Arriba del historial del Laboratorio: con qué clientes corre (los de fábrica
 * o los de este negocio), generarlos con la IA a partir del tipo de negocio y
 * del conocimiento del agente, y editarlos, quitarlos o agregar los tuyos.
 */

const SUGERENCIAS = [
  "Peluquería y estética",
  "Escuela",
  "Consultorio dental",
  "Restaurante",
  "Taller mecánico",
  "Inmobiliaria",
  "Gimnasio",
  "Agente de seguros",
  "Agencia de marketing",
];

const LLAVE_ABIERTO = "vocero.labClientesAbierto";

type Datos = { negocio: NegocioDto | null; clientes: ClienteDto[]; fabrica: ClienteDto[] };

async function leerError(res: Response | null, porDefecto: string): Promise<string> {
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? porDefecto;
}

export function ClientesALaMedida({ deshabilitado }: { deshabilitado?: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [rehaciendo, setRehaciendo] = useState<string | null>(null);
  const [formGenerar, setFormGenerar] = useState(false);
  const [editando, setEditando] = useState<ClienteDto | "nuevo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/lab/clientes").catch(() => null);
    if (res?.ok) setDatos((await res.json()) as Datos);
  }, []);

  useEffect(() => {
    void cargar();
    try {
      if (localStorage.getItem(LLAVE_ABIERTO) === "false") setAbierto(false);
    } catch {
      // sin almacenamiento: queda abierto
    }
  }, [cargar]);

  function alternar() {
    setAbierto((a) => {
      try {
        localStorage.setItem(LLAVE_ABIERTO, String(!a));
      } catch {
        // sin almacenamiento: solo esta vez
      }
      return !a;
    });
  }

  if (!datos) return null;

  const usarPropios = datos.negocio?.usarPropios ?? true;
  const hayPropios = datos.clientes.length > 0;
  const vista: "fabrica" | "negocio" = usarPropios ? "negocio" : "fabrica";
  const activos = datos.clientes.filter((c) => c.activo).length;
  const nombreNegocio = datos.negocio?.tipoNegocio || "mi negocio";
  const resumen =
    vista === "negocio" && activos > 0
      ? `La próxima corrida usa ${activos} cliente${activos === 1 ? "" : "s"} de ${nombreNegocio}`
      : "La próxima corrida usa los clientes de fábrica (ferretería)";

  async function elegir(v: "fabrica" | "negocio") {
    setError(null);
    const res = await fetch("/api/lab/clientes", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usarPropios: v === "negocio" }),
    }).catch(() => null);
    if (!res?.ok) return setError(await leerError(res, "No se pudo cambiar"));
    void cargar();
  }

  async function generar(tipoNegocio: string, quienes: string) {
    setGenerando(true);
    setError(null);
    const res = await fetch("/api/lab/clientes/generar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tipoNegocio, quienes }),
    }).catch(() => null);
    setGenerando(false);
    if (!res?.ok) return setError(await leerError(res, "No se pudieron generar los clientes"));
    setFormGenerar(false);
    void cargar();
  }

  async function otroGuion(c: ClienteDto) {
    setRehaciendo(c.id);
    setError(null);
    const res = await fetch(`/api/lab/clientes/${c.id}/otro`, { method: "POST" }).catch(() => null);
    setRehaciendo(null);
    if (!res?.ok) return setError(await leerError(res, "No se pudo escribir otro guion"));
    void cargar();
  }

  async function usar(c: ClienteDto, activo: boolean) {
    const res = await fetch(`/api/lab/clientes/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activo }),
    }).catch(() => null);
    if (!res?.ok) setError(await leerError(res, "No se pudo cambiar"));
    void cargar();
  }

  async function quitar(c: ClienteDto) {
    if (!window.confirm(`¿Quitar a «${c.nombre}» de tus clientes de prueba?`)) return;
    const res = await fetch(`/api/lab/clientes/${c.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError(await leerError(res, "No se pudo quitar"));
    void cargar();
  }

  return (
    <section className="mx-4 mt-4 rounded-lg border bg-card sm:mx-6 sm:mt-6" data-lab-a-la-medida>
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={abierto}
          className="flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block font-semibold">Clientes de prueba</span>
            <span className="block text-xs text-muted-foreground">{resumen}</span>
          </span>
          {abierto ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-text-3" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-text-3" aria-hidden />
          )}
        </button>
        {abierto && (
          <div className="inline-flex rounded-full border p-0.5" role="group" aria-label="Con qué clientes corre">
            {(["fabrica", "negocio"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vista === v}
                onClick={() => vista !== v && void elegir(v)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  vista === v ? "bg-primary text-primary-foreground" : "text-text-2 hover:text-foreground"
                )}
              >
                {v === "fabrica" ? "De fábrica" : `De ${nombreNegocio}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {abierto && (
        <div className="border-t p-4">
          {error && (
            <p role="alert" className="mb-3 text-sm text-danger-text">
              {error}
            </p>
          )}

          {vista === "fabrica" ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Los de fábrica hablan de una ferretería. Cambia a «De {nombreNegocio}» para
                probar con clientes de tu negocio.
              </p>
              <Rejilla clientes={datos.fabrica} />
            </>
          ) : !hayPropios || formGenerar ? (
            <FormGenerar
              negocio={datos.negocio}
              generando={generando}
              hayPropios={hayPropios}
              deshabilitado={deshabilitado}
              onGenerar={(t, q) => void generar(t, q)}
              onCancelar={hayPropios ? () => setFormGenerar(false) : undefined}
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setFormGenerar(true)} disabled={deshabilitado}>
                  <Sparkles className="h-3.5 w-3.5" /> Volver a generar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditando("nuevo")}>
                  <Plus className="h-3.5 w-3.5" /> Agregar cliente
                </Button>
              </div>
              <Rejilla
                clientes={datos.clientes}
                rehaciendo={rehaciendo}
                onEditar={setEditando}
                onOtro={deshabilitado ? undefined : (c) => void otroGuion(c)}
                onQuitar={(c) => void quitar(c)}
                onUsar={(c, a) => void usar(c, a)}
              />
            </>
          )}
        </div>
      )}

      {editando && (
        <VentanaCliente
          cliente={editando === "nuevo" ? null : editando}
          onCancel={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            void cargar();
          }}
        />
      )}
    </section>
  );
}

function FormGenerar({
  negocio,
  generando,
  hayPropios,
  deshabilitado,
  onGenerar,
  onCancelar,
}: {
  negocio: NegocioDto | null;
  generando: boolean;
  hayPropios: boolean;
  deshabilitado?: boolean;
  onGenerar: (tipoNegocio: string, quienes: string) => void;
  onCancelar?: () => void;
}) {
  const [tipo, setTipo] = useState(negocio?.tipoNegocio ?? "");
  const [quienes, setQuienes] = useState(negocio?.quienes ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onGenerar(tipo.trim(), quienes.trim());
      }}
      className="mx-auto max-w-xl space-y-3"
    >
      <p className="text-sm text-muted-foreground">
        La IA lee el perfil y el conocimiento de tu agente y escribe 8 clientes que hablan de
        lo que tú vendes: uno por cada cosa que hay que probarle (un comprador, uno enojado,
        uno que pide humano…). Luego los revisas y los editas.
        {hayPropios && " Los que agregaste a mano se quedan."}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="lab-tipo-negocio">Tipo de negocio</Label>
        <Input
          id="lab-tipo-negocio"
          list="lab-tipos-negocio"
          value={tipo}
          maxLength={MAX_TIPO_NEGOCIO}
          placeholder="Ej.: peluquería, escuela… Vacío: la IA lo deduce de tu agente"
          onChange={(e) => setTipo(e.target.value)}
        />
        <datalist id="lab-tipos-negocio">
          {SUGERENCIAS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lab-quienes">¿Quiénes te escriben? (opcional)</Label>
        <Textarea
          id="lab-quienes"
          rows={2}
          value={quienes}
          maxLength={MAX_QUIENES}
          placeholder="Ej.: papás de niños de kinder que buscan escuela para el próximo ciclo"
          onChange={(e) => setQuienes(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={generando || deshabilitado}>
          <Sparkles className="h-4 w-4" />
          {generando ? "Escribiendo tus clientes…" : "Generar clientes de mi negocio"}
        </Button>
        {onCancelar && (
          <Button type="button" variant="ghost" onClick={onCancelar} disabled={generando}>
            Cancelar
          </Button>
        )}
      </div>
      {generando && (
        <p className="text-xs text-muted-foreground">Tarda hasta un minuto. Usa la llave de Ajustes → IA.</p>
      )}
      {deshabilitado && (
        <p className="text-xs text-muted-foreground">Configura tu IA en Ajustes → IA para generarlos.</p>
      )}
    </form>
  );
}

function Rejilla({
  clientes,
  rehaciendo,
  onEditar,
  onOtro,
  onQuitar,
  onUsar,
}: {
  clientes: ClienteDto[];
  rehaciendo?: string | null;
  onEditar?: (c: ClienteDto) => void;
  onOtro?: (c: ClienteDto) => void;
  onQuitar?: (c: ClienteDto) => void;
  onUsar?: (c: ClienteDto, activo: boolean) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {clientes.map((c) => {
        const t = TIPOS_CLIENTE[c.tipo];
        return (
          <article
            key={c.id}
            className={cn("flex flex-col gap-2 rounded-lg border bg-background p-3", !c.activo && "opacity-55")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{c.nombre}</h3>
                <p className="text-xs text-muted-foreground">Prueba: {t.prueba}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px]",
                  c.propio ? "bg-warning-tint text-warning-text" : "bg-brand-tint text-brand-text"
                )}
              >
                {c.propio ? "tuyo · " : ""}
                {t.label}
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-md bg-subtle p-2">
              {c.guion.map((l, i) => (
                <span
                  key={i}
                  className="max-w-[92%] self-start rounded-md rounded-bl-sm border bg-card px-2 py-1 text-[13px] leading-snug"
                >
                  {l}
                </span>
              ))}
            </div>
            {onEditar && (
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => onEditar(c)}>
                  Editar
                </Button>
                {onOtro && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rehaciendo === c.id}
                    onClick={() => onOtro(c)}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {rehaciendo === c.id ? "Escribiendo…" : "Otro guion"}
                  </Button>
                )}
                {onQuitar && (
                  <Button variant="ghost" size="sm" onClick={() => onQuitar(c)}>
                    Quitar
                  </Button>
                )}
                {onUsar && (
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={c.activo} onChange={(e) => onUsar(c, e.target.checked)} />
                    Usar
                  </label>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function VentanaCliente({
  cliente,
  onCancel,
  onGuardado,
}: {
  cliente: ClienteDto | null;
  onCancel: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoCliente>(cliente?.tipo ?? "fuera_de_kb");
  const [guion, setGuion] = useState((cliente?.guion ?? []).join("\n"));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    const res = await fetch(cliente ? `/api/lab/clientes/${cliente.id}` : "/api/lab/clientes", {
      method: cliente ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre, tipo, guion: guion.split("\n") }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) return setError(await leerError(res, "No se pudo guardar"));
    onGuardado();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lab-cliente-titulo"
      onClick={onCancel}
    >
      <form
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-lg border bg-popover p-5 shadow-pop"
      >
        <h3 id="lab-cliente-titulo" className="text-[16px] font-bold">
          {cliente ? "Editar cliente de prueba" : "Agregar un cliente tuyo"}
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="lab-cliente-nombre">Nombre</Label>
          <Input
            id="lab-cliente-nombre"
            value={nombre}
            maxLength={MAX_NOMBRE}
            placeholder="Ej.: Pregunta por estacionamiento"
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-cliente-tipo">Tipo de cliente (qué le prueba al agente)</Label>
          <select
            id="lab-cliente-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoCliente)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {CLAVES_TIPO.map((k) => (
              <option key={k} value={k}>
                {TIPOS_CLIENTE[k].label} — {TIPOS_CLIENTE[k].prueba}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-cliente-guion">Lo que escribe, un mensaje por renglón</Label>
          <Textarea
            id="lab-cliente-guion"
            rows={6}
            value={guion}
            placeholder={"¿Tienen estacionamiento?\n¿Aceptan tarjeta?\nOk, gracias"}
            onChange={(e) => setGuion(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Hasta {MAX_LINEAS} mensajes. El agente contesta entre uno y otro.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={ocupado}>
            {ocupado ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
