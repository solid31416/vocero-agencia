"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, Globe, Mail, MessageCircle, Phone, Plus, Star, Trash2, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumeroInput } from "@/components/ui/numero-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatoDinero } from "@/lib/cotizaciones";
import {
  ENVIO_INFO,
  ESTADOS_MX,
  MAX_TARIFAS,
  MAX_TRANSPORTISTAS,
  diasDesde,
  opcionesDeFlete,
  type ConfigFletes,
  type Tarifa,
  type Transportista,
} from "@/lib/fletes";
import { fechaLegible, type PedidoDto } from "@/lib/pedidos";

/**
 * Módulo de la agencia — Ajustes → Ventas → Fletes: el seguimiento de los
 * envíos, el tabulador (lo que te cobra cada transportista y lo que le cobras
 * al cliente) y el directorio de transportistas. Todo es interno.
 */

type Datos = {
  fletes: ConfigFletes;
  moneda: "MXN" | "USD";
  hoy: string;
  conPedidos: boolean;
  puedeEditar: boolean;
};

type Pestana = "envios" | "tabulador" | "transportistas";

const claseSelect = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";

function nuevaClave(prefijo: string): string {
  return `${prefijo}_${Math.random().toString(36).slice(2, 10)}`;
}

function soloDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

function urlDePagina(s: string): string {
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export function FletesClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [f, setF] = useState<ConfigFletes | null>(null);
  const [pestana, setPestana] = useState<Pestana>("tabulador");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/fletes").catch(() => null);
    if (!res?.ok) return setAviso({ ok: false, texto: "No se pudieron cargar los fletes" });
    const d = (await res.json()) as Datos;
    setDatos(d);
    setF(d.fletes);
    // Con envíos que seguir, se abre ahí; si no, en el tabulador.
    if (d.conPedidos) setPestana("envios");
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || !f) {
    return <p className="text-sm text-muted-foreground">{aviso?.texto ?? "Cargando…"}</p>;
  }
  const editable = datos.puedeEditar;
  const sinCambios = JSON.stringify(f) === JSON.stringify(datos.fletes);
  const cambiar = (p: Partial<ConfigFletes>) => {
    setF({ ...f, ...p });
    setAviso(null);
  };

  async function guardar() {
    setGuardando(true);
    const res = await fetch("/api/settings/fletes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(f),
    }).catch(() => null);
    setGuardando(false);
    const d = (await res?.json().catch(() => null)) as { fletes?: ConfigFletes; error?: { message?: string } } | null;
    if (!res?.ok || !d?.fletes) {
      // «tarifas.2.precio: …» → «Tarifa 3: …»
      const texto = (d?.error?.message ?? "No se pudo guardar")
        .split("; ")[0]!
        .replace(/^tarifas\.(\d+)(\.\w+)?: /, (_, n: string) => `Tarifa ${Number(n) + 1}: `)
        .replace(/^transportistas\.(\d+)(\.\w+)?: /, (_, n: string) => `Transportista ${Number(n) + 1}: `)
        .replace(/^(tarifas|transportistas): /, "");
      return setAviso({ ok: false, texto });
    }
    setDatos((x) => (x ? { ...x, fletes: d.fletes! } : x));
    setF(d.fletes);
    setAviso({ ok: true, texto: "Guardado." });
  }

  const pestanas: { id: Pestana; texto: string }[] = [
    ...(datos.conPedidos ? [{ id: "envios" as const, texto: "Envíos" }] : []),
    { id: "tabulador", texto: `Tabulador (${f.tarifas.length})` },
    { id: "transportistas", texto: `Transportistas (${f.transportistas.length})` },
  ];

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Fletes
          </CardTitle>
          <CardDescription>
            Tus transportistas, cuánto cuesta llevar el producto a cada lugar y el seguimiento de cada envío. Todo
            es interno: el cliente solo ve el precio del flete en su cotización, nunca tu costo ni los datos de la
            transportista.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {pestanas.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pestana === p.id}
                data-pestana={p.id}
                onClick={() => setPestana(p.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  pestana === p.id ? "border-primary bg-brand-tint font-medium text-brand-text" : "text-text-2"
                )}
              >
                {p.texto}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {pestana === "envios" && <Envios moneda={datos.moneda} />}

      {pestana === "tabulador" && (
        <Tabulador f={f} cambiar={cambiar} editable={editable} hoy={datos.hoy} moneda={datos.moneda} />
      )}

      {pestana === "transportistas" && <Transportistas f={f} cambiar={cambiar} editable={editable} />}

      {pestana !== "envios" && editable && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
          {aviso && (
            <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
              {aviso.texto}
            </p>
          )}
          {!sinCambios && (
            <Button type="button" variant="ghost" onClick={() => setF(datos.fletes)} disabled={guardando}>
              Descartar
            </Button>
          )}
          <Button type="button" onClick={guardar} disabled={guardando || sinCambios} data-guardar-fletes>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      )}
      {!editable && pestana !== "envios" && (
        <p className="text-xs text-text-3">Solo quien administra puede cambiar los fletes.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ tabulador */

function Tabulador({
  f,
  cambiar,
  editable,
  hoy,
  moneda,
}: {
  f: ConfigFletes;
  cambiar: (p: Partial<ConfigFletes>) => void;
  editable: boolean;
  hoy: string;
  moneda: "MXN" | "USD";
}) {
  const [filtro, setFiltro] = useState("");
  const [prueba, setPrueba] = useState({ estado: "", ciudad: "", piezas: 1 });
  const dinero = (n: number) => formatoDinero(n, moneda);

  const opciones = useMemo(
    () => (prueba.estado ? opcionesDeFlete(f, prueba, hoy) : []),
    [f, prueba, hoy]
  );
  const visibles = f.tarifas
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !filtro || t.estado === filtro);
  const estadosUsados = [...new Set(f.tarifas.map((t) => t.estado))].sort((a, b) => a.localeCompare(b, "es"));
  const viejas = f.tarifas.filter((t) => {
    const d = diasDesde(t.actualizada, hoy);
    return d === null || d > f.diasVigencia;
  }).length;

  const cambiarTarifa = (i: number, p: Partial<Tarifa>) =>
    cambiar({ tarifas: f.tarifas.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const agregar = (base?: Tarifa) =>
    cambiar({
      tarifas: [
        ...f.tarifas,
        base
          ? { ...base, id: nuevaClave("ta") }
          : {
              id: nuevaClave("ta"),
              transportistaId: f.transportistas.find((t) => t.activa)?.id ?? null,
              estado: filtro || "Nuevo León",
              ciudad: "",
              desde: 1,
              hasta: 10,
              modo: "viaje",
              costo: 0,
              precio: 0,
              dias: "",
              actualizada: hoy,
              notas: "",
            },
      ],
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Origen y vigencia</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fl-origen">De dónde sale el producto</Label>
            <Input
              id="fl-origen"
              value={f.origen}
              maxLength={80}
              disabled={!editable}
              onChange={(e) => cambiar({ origen: e.target.value })}
            />
            <p className="text-[11px] text-text-3">Sale en el concepto del flete en la cotización.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fl-vigencia">Avisar tarifas sin actualizar después de (días)</Label>
            <NumeroInput
              id="fl-vigencia"
              min={7}
              max={365}
              entero
              value={f.diasVigencia}
              disabled={!editable}
              onValueChange={(n) => cambiar({ diasVigencia: n })}
            />
            <p className="text-[11px] text-text-3">Los fletes cambian: confirma cada tarifa de vez en cuando.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Probar el tabulador</CardTitle>
          <CardDescription>¿Cuánto sale llevar N piezas a un lugar? (con lo que tienes en pantalla, aunque no lo hayas guardado)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem]">
            <select
              aria-label="Estado a probar"
              className={claseSelect}
              value={prueba.estado}
              onChange={(e) => setPrueba({ ...prueba, estado: e.target.value })}
            >
              <option value="">— Estado —</option>
              {ESTADOS_MX.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            <Input
              aria-label="Ciudad a probar"
              placeholder="Ciudad (opcional)"
              value={prueba.ciudad}
              onChange={(e) => setPrueba({ ...prueba, ciudad: e.target.value })}
            />
            <NumeroInput
              aria-label="Piezas a probar"
              min={1}
              max={1000}
              entero
              value={prueba.piezas}
              onValueChange={(piezas) => setPrueba({ ...prueba, piezas })}
            />
          </div>
          {prueba.estado && opciones.length === 0 && (
            <p className="text-sm text-text-3" data-prueba-flete="sin">
              No hay tarifa para ese destino y esa cantidad. En la cotización se escribe a mano, y el agente dice que
              lo confirma un asesor.
            </p>
          )}
          {opciones.length > 0 && (
            <ul className="space-y-1.5" data-prueba-flete="con">
              {opciones.map((o, k) => (
                <li key={o.tarifaId} className={cn("rounded-md border p-2 text-sm", k === 0 && "border-primary")}>
                  <span className="font-medium">{dinero(o.precio)}</span> al cliente ·{" "}
                  <span className="text-text-3">
                    te cuesta {dinero(o.costo)} · margen {dinero(o.margen)}
                  </span>
                  <br />
                  <span className="text-xs text-text-3">
                    {o.transportista} · {o.destino} · {o.modo === "pieza" ? "por pieza" : "por viaje"}
                    {o.dias && ` · ${o.dias}`}
                    {k === 0 && " · la que se propone"}
                    {o.vieja && " · ⚠ tarifa sin actualizar"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tarifas</CardTitle>
          <CardDescription>
            Cada renglón: a dónde, para cuántas piezas, lo que <strong>te cobra</strong> la transportista (interno) y lo
            que <strong>le cobras al cliente</strong>. «Por viaje» es un precio por todo el envío; «por pieza» se
            multiplica por las piezas. Sin ciudad, aplica a todo el estado; si hay una de la ciudad exacta, gana esa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {f.transportistas.length === 0 && (
            <p className="rounded-md bg-subtle p-2 text-xs text-text-3">
              Puedes capturar tarifas generales, o primero dar de alta tus transportistas en su pestaña.
            </p>
          )}
          {viejas > 0 && (
            <p className="flex items-center gap-1.5 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning-text">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {viejas === 1 ? "1 tarifa lleva" : `${viejas} tarifas llevan`} más de {f.diasVigencia} días sin
              actualizar.
            </p>
          )}
          {estadosUsados.length > 1 && (
            <select
              aria-label="Filtrar por estado"
              className={cn(claseSelect, "max-w-xs")}
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            >
              <option value="">Todos los estados</option>
              {estadosUsados.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          )}

          <ul className="space-y-2">
            {visibles.map(({ t, i }) => {
              const edad = diasDesde(t.actualizada, hoy);
              const vieja = edad === null || edad > f.diasVigencia;
              const margen = t.precio - t.costo;
              return (
                <li key={t.id} className="space-y-2 rounded-md border p-2.5" data-tarifa={t.id}>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Transportista</Label>
                      <select
                        aria-label="Transportista"
                        className={claseSelect}
                        value={t.transportistaId ?? ""}
                        disabled={!editable}
                        onChange={(e) => cambiarTarifa(i, { transportistaId: e.target.value || null })}
                      >
                        <option value="">Tarifa general</option>
                        {f.transportistas.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nombre || "(sin nombre)"}
                            {!x.activa ? " (pausada)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Estado</Label>
                      <select
                        aria-label="Estado"
                        className={claseSelect}
                        value={t.estado}
                        disabled={!editable}
                        onChange={(e) => cambiarTarifa(i, { estado: e.target.value })}
                      >
                        {ESTADOS_MX.map((e) => (
                          <option key={e}>{e}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Ciudad (vacía = todo el estado)</Label>
                      <Input
                        aria-label="Ciudad"
                        value={t.ciudad}
                        maxLength={60}
                        disabled={!editable}
                        placeholder="Todo el estado"
                        onChange={(e) => cambiarTarifa(i, { ciudad: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Desde (piezas)</Label>
                      <NumeroInput
                        aria-label="Desde"
                        min={1}
                        max={1000}
                        entero
                        value={t.desde}
                        disabled={!editable}
                        onValueChange={(desde) => cambiarTarifa(i, { desde })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Hasta</Label>
                      <NumeroInput
                        aria-label="Hasta"
                        min={1}
                        max={1000}
                        entero
                        value={t.hasta}
                        disabled={!editable}
                        className={cn(t.hasta < t.desde && "border-danger-text")}
                        onValueChange={(hasta) => cambiarTarifa(i, { hasta })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Cobra</Label>
                      <select
                        aria-label="Cómo cobra"
                        className={claseSelect}
                        value={t.modo}
                        disabled={!editable}
                        onChange={(e) => cambiarTarifa(i, { modo: e.target.value as Tarifa["modo"] })}
                      >
                        <option value="viaje">Por viaje</option>
                        <option value="pieza">Por pieza</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Te cobra (interno)</Label>
                      <NumeroInput
                        aria-label="Costo"
                        min={0}
                        step="0.01"
                        value={t.costo}
                        disabled={!editable}
                        onValueChange={(costo) => cambiarTarifa(i, { costo })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Le cobras al cliente</Label>
                      <NumeroInput
                        aria-label="Precio al cliente"
                        min={0}
                        step="0.01"
                        value={t.precio}
                        disabled={!editable}
                        className={cn(!(t.precio > 0) && "border-danger-text")}
                        onValueChange={(precio) => cambiarTarifa(i, { precio })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-text-3">Tiempo de entrega</Label>
                      <Input
                        aria-label="Tiempo de entrega"
                        value={t.dias}
                        maxLength={30}
                        placeholder="3 a 5 días"
                        disabled={!editable}
                        onChange={(e) => cambiarTarifa(i, { dias: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                    <span className={cn(margen < 0 ? "text-danger-text" : "text-text-3")}>
                      Margen {formatoDinero(margen, moneda)}
                      {t.modo === "pieza" ? " por pieza" : ""}
                      {t.precio > 0 && ` (${Math.round((margen / t.precio) * 100)}%)`}
                    </span>
                    {!(t.precio > 0) && <span className="text-danger-text">Sin precio al cliente: no se usa</span>}
                    <label className="flex items-center gap-1.5 text-text-3">
                      Actualizada
                      <input
                        type="date"
                        aria-label="Actualizada el"
                        value={t.actualizada ?? ""}
                        disabled={!editable}
                        onChange={(e) => cambiarTarifa(i, { actualizada: e.target.value || null })}
                        className={cn("h-7 rounded border px-1", vieja && "border-warning-text text-warning-text")}
                      />
                    </label>
                    {editable && t.actualizada !== hoy && (
                      <button type="button" className="text-brand-text hover:underline" onClick={() => cambiarTarifa(i, { actualizada: hoy })}>
                        Confirmada hoy
                      </button>
                    )}
                    {vieja && <span className="text-warning-text">⚠ sin actualizar</span>}
                    <Input
                      aria-label="Notas de la tarifa"
                      value={t.notas}
                      maxLength={200}
                      placeholder="Notas (incluye maniobras, solo hasta caseta…)"
                      disabled={!editable}
                      className="h-7 min-w-[12rem] flex-1 text-xs"
                      onChange={(e) => cambiarTarifa(i, { notas: e.target.value })}
                    />
                    {editable && (
                      <span className="ml-auto flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Duplicar tarifa"
                          disabled={f.tarifas.length >= MAX_TARIFAS}
                          onClick={() => agregar(t)}
                        >
                          <Copy className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Quitar tarifa"
                          onClick={() => cambiar({ tarifas: f.tarifas.filter((_, j) => j !== i) })}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {f.tarifas.length === 0 && (
            <p className="text-sm text-text-3">Aún no hay tarifas. Agrega la primera con lo que te cotizó una transportista.</p>
          )}
          {editable && f.tarifas.length < MAX_TARIFAS && (
            <Button type="button" variant="outline" size="sm" onClick={() => agregar()} data-agregar-tarifa>
              <Plus className="mr-1 h-4 w-4" aria-hidden /> Agregar tarifa
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ transportistas */

function Transportistas({
  f,
  cambiar,
  editable,
}: {
  f: ConfigFletes;
  cambiar: (p: Partial<ConfigFletes>) => void;
  editable: boolean;
}) {
  const cambiarT = (i: number, p: Partial<Transportista>) =>
    cambiar({ transportistas: f.transportistas.map((t, j) => (j === i ? { ...t, ...p } : t)) });

  function quitar(i: number) {
    const t = f.transportistas[i];
    if (!t) return;
    const suyas = f.tarifas.filter((x) => x.transportistaId === t.id).length;
    const pregunta = suyas
      ? `¿Quitar a ${t.nombre || "esta transportista"}? También se quitan sus ${suyas} tarifa(s). Si solo dejó de trabajar contigo, mejor pausarla.`
      : `¿Quitar a ${t.nombre || "esta transportista"}?`;
    if (!window.confirm(pregunta)) return;
    cambiar({
      transportistas: f.transportistas.filter((_, j) => j !== i),
      tarifas: f.tarifas.filter((x) => x.transportistaId !== t.id),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transportistas</CardTitle>
        <CardDescription>
          Las empresas de fletes con las que trabajas. Sus datos son solo para tu equipo: el agente nunca se los da al
          cliente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {f.transportistas.length === 0 && <p className="text-sm text-text-3">Aún no has dado de alta transportistas.</p>}
        <ul className="space-y-3">
          {f.transportistas.map((t, i) => {
            const tarifas = f.tarifas.filter((x) => x.transportistaId === t.id).length;
            const wa = soloDigitos(t.whatsapp);
            return (
              <li key={t.id} className={cn("space-y-2 rounded-md border p-3", !t.activa && "opacity-70")} data-transportista={t.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <Switch
                    checked={t.activa}
                    onCheckedChange={(activa) => cambiarT(i, { activa })}
                    label={`${t.nombre || "Transportista"} activa`}
                    disabled={!editable}
                  />
                  <Input
                    aria-label="Nombre de la transportista"
                    value={t.nombre}
                    maxLength={80}
                    placeholder="Nombre de la empresa"
                    disabled={!editable}
                    className={cn("min-w-[12rem] flex-1 font-medium", !t.nombre.trim() && "border-danger-text")}
                    onChange={(e) => cambiarT(i, { nombre: e.target.value })}
                  />
                  <div className="flex items-center gap-0.5" aria-label={`Calificación: ${t.calificacion} de 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={!editable}
                        aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
                        onClick={() => cambiarT(i, { calificacion: t.calificacion === n ? 0 : n })}
                      >
                        <Star
                          className={cn("h-4 w-4", n <= t.calificacion ? "fill-amber-400 text-amber-400" : "text-text-3")}
                          aria-hidden
                        />
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-text-3">
                    {t.activa ? "Activa" : "Pausada"} · {tarifas} tarifa{tarifas === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Campo etiqueta="Contacto" valor={t.contacto} max={80} editable={editable} onChange={(contacto) => cambiarT(i, { contacto })} placeholder="Con quién tratas" />
                  <Campo etiqueta="WhatsApp" valor={t.whatsapp} max={30} editable={editable} onChange={(whatsapp) => cambiarT(i, { whatsapp })} placeholder="81 1234 5678" />
                  <Campo etiqueta="Teléfono" valor={t.telefono} max={30} editable={editable} onChange={(telefono) => cambiarT(i, { telefono })} />
                  <Campo etiqueta="Correo" valor={t.correo} max={120} editable={editable} onChange={(correo) => cambiarT(i, { correo })} placeholder="fletes@empresa.com" />
                  <Campo etiqueta="Página" valor={t.pagina} max={200} editable={editable} onChange={(pagina) => cambiarT(i, { pagina })} placeholder="www.empresa.com" />
                  <Campo etiqueta="Unidades" valor={t.unidades} max={120} editable={editable} onChange={(unidades) => cambiarT(i, { unidades })} placeholder="Plataforma, caja seca…" />
                </div>
                <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-text-3">Piezas por viaje</Label>
                    <Input
                      aria-label="Piezas por viaje"
                      type="number"
                      min={1}
                      max={1000}
                      value={t.capacidad ?? ""}
                      placeholder="No se sabe"
                      disabled={!editable}
                      onChange={(e) => cambiarT(i, { capacidad: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-text-3">Notas</Label>
                    <Textarea
                      aria-label="Notas de la transportista"
                      rows={2}
                      maxLength={500}
                      value={t.notas}
                      placeholder="Cobra por adelantado, no entra a terracería, seguro incluido…"
                      disabled={!editable}
                      onChange={(e) => cambiarT(i, { notas: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {wa.length >= 10 && (
                    <a href={`https://wa.me/${wa.length === 10 ? `52${wa}` : wa}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-text hover:underline">
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
                    </a>
                  )}
                  {soloDigitos(t.telefono).length >= 7 && (
                    <a href={`tel:${soloDigitos(t.telefono)}`} className="flex items-center gap-1 text-brand-text hover:underline">
                      <Phone className="h-3.5 w-3.5" aria-hidden /> Llamar
                    </a>
                  )}
                  {t.correo.includes("@") && (
                    <a href={`mailto:${t.correo}`} className="flex items-center gap-1 text-brand-text hover:underline">
                      <Mail className="h-3.5 w-3.5" aria-hidden /> Correo
                    </a>
                  )}
                  {t.pagina.includes(".") && (
                    <a href={urlDePagina(t.pagina)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-text hover:underline">
                      <Globe className="h-3.5 w-3.5" aria-hidden /> Página
                    </a>
                  )}
                  {editable && (
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => quitar(i)} aria-label="Quitar transportista">
                      <Trash2 className="mr-1 h-4 w-4" aria-hidden /> Quitar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {editable && f.transportistas.length < MAX_TRANSPORTISTAS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-agregar-transportista
            onClick={() =>
              cambiar({
                transportistas: [
                  ...f.transportistas,
                  {
                    id: nuevaClave("tr"),
                    nombre: "",
                    contacto: "",
                    whatsapp: "",
                    telefono: "",
                    correo: "",
                    pagina: "",
                    unidades: "",
                    capacidad: null,
                    calificacion: 0,
                    notas: "",
                    activa: true,
                  },
                ],
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Agregar transportista
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Campo({
  etiqueta,
  valor,
  max,
  editable,
  onChange,
  placeholder,
}: {
  etiqueta: string;
  valor: string;
  max: number;
  editable: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-text-3">{etiqueta}</Label>
      <Input aria-label={etiqueta} value={valor} maxLength={max} placeholder={placeholder} disabled={!editable} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ------------------------------------------------------------ envíos */

function Envios({ moneda }: { moneda: "MXN" | "USD" }) {
  const [pedidos, setPedidos] = useState<PedidoDto[] | null>(null);
  const [todos, setTodos] = useState(false);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/fletes/envios").catch(() => null);
      const d = (await res?.json().catch(() => null)) as { pedidos?: PedidoDto[] } | null;
      setPedidos(d?.pedidos ?? []);
    })();
  }, []);
  if (!pedidos) return <p className="text-sm text-muted-foreground">Cargando envíos…</p>;
  const activos = pedidos.filter((p) => p.envio && p.envio.estado !== "entregado");
  const lista = todos ? pedidos : activos;
  const conteo = (estado: string) => pedidos.filter((p) => p.envio?.estado === estado).length;
  const atrasados = pedidos.filter((p) => p.envioAtrasado).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Seguimiento de envíos</CardTitle>
        <CardDescription>
          Los pedidos con envío. El envío se captura y se actualiza en cada pedido (
          <Link href="/pedidos" className="text-brand-text hover:underline">
            Pedidos
          </Link>{" "}
          o en el chat). Al cliente se le avisa con las etapas del pedido, como siempre.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {(["por_programar", "programado", "en_camino", "incidencia", "entregado"] as const).map((e) => (
            <span key={e} className="rounded-full border px-2 py-0.5" style={{ color: ENVIO_INFO[e].color }}>
              {ENVIO_INFO[e].etiqueta}: {conteo(e)}
            </span>
          ))}
          {atrasados > 0 && (
            <span className="rounded-full bg-danger-tint px-2 py-0.5 text-danger-text">Atrasados: {atrasados}</span>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Ver también los
          entregados
        </label>
        {lista.length === 0 && (
          <p className="text-sm text-text-3">
            {pedidos.length === 0
              ? "Todavía ningún pedido tiene envío. Captúralo en el pedido, con «Envío»."
              : "No hay envíos pendientes."}
          </p>
        )}
        <ul className="space-y-2">
          {lista.map((p) => {
            const e = p.envio!;
            const info = ENVIO_INFO[e.estado];
            return (
              <li key={p.id} className="rounded-md border p-2.5 text-sm" data-envio={p.folio}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0">
                    <span className="font-mono text-xs text-text-3">{p.folio}</span>{" "}
                    {p.conversationId ? (
                      <Link
                        href={`/inbox?conversation=${encodeURIComponent(p.conversationId)}`}
                        className="font-medium text-brand-text hover:underline"
                      >
                        {p.contactoNombre}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.contactoNombre}</span>
                    )}{" "}
                    · {p.concepto}
                  </p>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: info.color }}>
                    {info.etiqueta}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-3">
                  {[
                    e.destino && `→ ${e.destino}`,
                    e.transportistaNombre,
                    e.guia && `Guía ${e.guia}`,
                    e.recoleccion && `Recolección ${fechaLegible(e.recoleccion)}`,
                    e.estado === "entregado" && e.entregadoEl
                      ? `Entregado ${fechaLegible(e.entregadoEl)}`
                      : e.entregaEstimada && `Llega ${fechaLegible(e.entregaEstimada)}`,
                    e.costo !== null && e.cobrado !== null && `Margen ${formatoDinero(e.cobrado - e.costo, moneda)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {p.envioAtrasado && <p className="mt-1 text-xs font-medium text-danger-text">⚠ Ya pasó la fecha estimada</p>}
                {e.notas && <p className="mt-1 text-xs text-text-2">{e.notas}</p>}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
