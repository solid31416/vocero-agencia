"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ImagePlus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ESTADO_INFO,
  MAX_PRODUCTOS,
  PLANTILLA_SEGUIMIENTO_SUGERIDA,
  formatoDinero,
  type ConfigCotizaciones,
  type CotizacionDto,
  type Producto,
} from "@/lib/cotizaciones";
import { pedirAceptar, textoDeAceptada } from "@/components/cotizaciones/aceptar-cotizacion";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Cotizaciones.
 *
 * Los datos que salen en el PDF (negocio, logo), la lista de productos con
 * precio (de aquí salen los precios: la IA nunca los pone), las condiciones
 * (vigencia, IVA, anticipo, forma de pago) y las últimas cotizaciones con su
 * estado.
 */

type Plantilla = { id: string; name: string; language: string; category: string; variables: number };

type Datos = {
  config: ConfigCotizaciones;
  tieneLogo: boolean;
  cotizaciones: CotizacionDto[];
  plantillas?: Plantilla[];
  puedeEditar: boolean;
};

type Pestana = "cotizaciones" | "productos" | "condiciones" | "seguimiento" | "negocio";

const nuevoId = () => `p_${Math.random().toString(36).slice(2, 10)}`;

export function CotizacionesClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [config, setConfig] = useState<ConfigCotizaciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const [pestana, setPestana] = useState<Pestana>("cotizaciones");
  const archivo = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/cotizaciones").catch(() => null);
    if (!res?.ok) return setError("No se pudieron cargar las cotizaciones");
    const d = (await res.json()) as Datos;
    setDatos(d);
    setConfig(d.config);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <p className="text-sm text-danger-text">{error}</p>;
  if (!datos || !config) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const editable = datos.puedeEditar;

  const cambiar = (parcial: Partial<ConfigCotizaciones>) => setConfig({ ...config, ...parcial });
  const cambiarNegocio = (parcial: Partial<ConfigCotizaciones["negocio"]>) =>
    setConfig({ ...config, negocio: { ...config.negocio, ...parcial } });
  const cambiarSeguimiento = (parcial: Partial<ConfigCotizaciones["seguimiento"]>) =>
    setConfig({ ...config, seguimiento: { ...config.seguimiento, ...parcial } });
  const cambiarProducto = (id: string, parcial: Partial<Producto>) =>
    cambiar({ productos: config.productos.map((p) => (p.id === id ? { ...p, ...parcial } : p)) });

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/settings/cotizaciones", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...config,
        // Un producto a medio escribir (sin nombre) no tumba el guardado: se ignora.
        productos: config!.productos.filter((p) => p.nombre.trim()),
      }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
    }
    setAviso({ ok: true, texto: "Guardado" });
    void cargar();
  }

  async function subirLogo(f: File) {
    setAviso(null);
    const form = new FormData();
    form.set("logo", f);
    const res = await fetch("/api/settings/cotizaciones/logo", { method: "POST", body: form }).catch(() => null);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo subir el logo" });
    }
    setLogoVersion((v) => v + 1);
    void cargar();
  }

  async function quitarLogo() {
    await fetch("/api/settings/cotizaciones/logo", { method: "DELETE" }).catch(() => null);
    void cargar();
  }

  /** Aceptada: con el módulo de pedidos, también nace su pedido (sin avisarle al cliente desde aquí). */
  async function aceptar(c: CotizacionDto) {
    const r = await pedirAceptar(c.id, { crearPedido: true, avisar: false, fechaEstimada: null });
    setAviso(r.ok ? { ok: !r.r.avisoPedido, texto: textoDeAceptada(c.folio, r.r) } : { ok: false, texto: r.error });
    void cargar();
  }

  async function cambiarEstado(id: string, estado: "aceptada" | "rechazada" | "enviada") {
    await fetch(`/api/cotizaciones/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estado }),
    }).catch(() => null);
    void cargar();
  }

  const pestanas: { id: Pestana; label: string; cuenta?: number }[] = [
    { id: "cotizaciones", label: "Cotizaciones", cuenta: datos.cotizaciones.length },
    { id: "productos", label: "Productos", cuenta: config.productos.length },
    { id: "condiciones", label: "Condiciones" },
    { id: "seguimiento", label: "Seguimiento" },
    { id: "negocio", label: "Mi negocio" },
  ];

  const botonGuardar = editable && (
    <div className="flex items-center gap-3 border-t pt-4">
      <Button onClick={() => void guardar()} disabled={guardando}>
        {guardando ? "Guardando…" : "Guardar cambios"}
      </Button>
      {aviso && (
        <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
          {aviso.texto}
        </span>
      )}
    </div>
  );

  return (
    <Card className="max-w-3xl" data-cotizaciones>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" aria-hidden /> Cotizaciones en PDF
        </CardTitle>
        <CardDescription>
          Desde la bandeja, el botón «Cotizar» arma un PDF con estos datos y se lo manda al cliente por
          WhatsApp. Los precios salen de tu lista: la IA solo propone productos y cantidades.
        </CardDescription>
        {/* Pestañas: cada una muestra solo lo suyo. Lo que escribas en una no
            se pierde al cambiar de pestaña; «Guardar cambios» guarda todo. */}
        <div
          role="tablist"
          aria-label="Secciones de cotizaciones"
          className="-mx-1 mt-3 flex gap-4 overflow-x-auto border-b px-1"
        >
          {pestanas.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`cot-tab-${t.id}`}
              aria-selected={pestana === t.id}
              aria-controls={`cot-panel-${t.id}`}
              onClick={() => setPestana(t.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[13px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                pestana === t.id
                  ? "border-brand text-foreground"
                  : "border-transparent text-text-3 hover:text-foreground"
              )}
            >
              {t.label}
              {t.cuenta !== undefined && (
                <span className="font-mono text-[11px] font-medium text-text-3">{t.cuenta}</span>
              )}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent
        role="tabpanel"
        id={`cot-panel-${pestana}`}
        aria-labelledby={`cot-tab-${pestana}`}
        className="space-y-5"
      >
        {pestana === "cotizaciones" && (
          <>
            <p className="text-sm text-muted-foreground">
              Márcalas como aceptadas o rechazadas cuando el cliente conteste. Al marcarla aceptada se crea su pedido
              (si tienes Pedidos encendido).
            </p>
            {aviso && (
              <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                {aviso.texto}
              </p>
            )}
            {datos.cotizaciones.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay ninguna. Se hacen desde la bandeja: «Cotizar».</p>
            ) : (
              <ul className="divide-y text-sm">
                {datos.cotizaciones.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <EstadoChip estado={c.estado} />
                    <a href={`/api/cotizaciones/${c.id}/pdf`} target="_blank" rel="noreferrer"
                      className="font-mono font-semibold hover:underline">
                      {c.folio}
                    </a>
                    {c.conversationId ? (
                      <Link href={`/inbox?conversation=${c.conversationId}`} className="font-medium hover:underline">
                        {c.contactoNombre}
                      </Link>
                    ) : (
                      <span className="font-medium">{c.contactoNombre}</span>
                    )}
                    <span className="text-text-3">{formatoDinero(c.totales.total, c.moneda)}</span>
                    {c.senal && (c.estado === "enviada" || c.estado === "vencida") && (
                      <span
                        title={`«${c.senal.texto}»`}
                        className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-text"
                      >
                        Parece que aceptó
                      </span>
                    )}
                    <span className="text-xs text-text-3">
                      {new Date(c.enviadaEn ?? c.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    </span>
                    {(c.estado === "enviada" || c.estado === "vencida") && (
                      <span className="ml-auto flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => void aceptar(c)}>
                          Aceptada
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void cambiarEstado(c.id, "rechazada")}>
                          Rechazada
                        </Button>
                      </span>
                    )}
                    {(c.estado === "aceptada" || c.estado === "rechazada") && (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void cambiarEstado(c.id, "enviada")}>
                        Deshacer
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {pestana === "productos" && (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[13px] font-bold">Productos y servicios ({config.productos.length})</Label>
                {editable && config.productos.length < MAX_PRODUCTOS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      cambiar({
                        productos: [
                          ...config.productos,
                          { id: nuevoId(), nombre: "", precio: 0, unidad: "pieza", descripcion: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden /> Agregar producto
                  </Button>
                )}
              </div>
              {config.productos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin productos todavía. Agrégalos con su precio: «Cotizar» los ofrece y la IA los usa para llenar
                  la cotización.
                </p>
              ) : (
                <ul className="space-y-3">
                  {config.productos.map((p) => (
                    <li key={p.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_7rem_6rem_auto]">
                      <Input aria-label="Nombre del producto" placeholder="Nombre" value={p.nombre} disabled={!editable}
                        onChange={(e) => cambiarProducto(p.id, { nombre: e.target.value })} />
                      <NumeroInput aria-label="Precio" min={0} step="0.01" value={p.precio} disabled={!editable}
                        onValueChange={(n) => cambiarProducto(p.id, { precio: n })} />
                      <Input aria-label="Unidad" placeholder="pieza" value={p.unidad} disabled={!editable}
                        onChange={(e) => cambiarProducto(p.id, { unidad: e.target.value })} />
                      {editable ? (
                        <Button type="button" variant="ghost" size="sm" aria-label={`Quitar ${p.nombre || "producto"}`}
                          onClick={() => cambiar({ productos: config.productos.filter((x) => x.id !== p.id) })}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Input aria-label="Descripción" placeholder="Descripción corta (sale en el PDF, opcional)"
                        value={p.descripcion} disabled={!editable} className="sm:col-span-4"
                        onChange={(e) => cambiarProducto(p.id, { descripcion: e.target.value })} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {botonGuardar}
          </>
        )}

        {pestana === "condiciones" && (
          <>
            <section className="space-y-3">
              <Label className="text-[13px] font-bold">Condiciones</Label>
              <div className="grid gap-3 sm:grid-cols-4">
                <Numero label="Vigencia (días)" value={config.vigenciaDias} min={1} max={365} disabled={!editable}
                  onChange={(v) => cambiar({ vigenciaDias: v })} />
                <Numero label="IVA (%)" value={config.ivaPct} min={0} max={30} disabled={!editable}
                  onChange={(v) => cambiar({ ivaPct: v })} />
                <Numero label="Anticipo (%)" value={config.anticipoPct} min={0} max={100} disabled={!editable}
                  onChange={(v) => cambiar({ anticipoPct: v })} />
                <div className="space-y-1.5">
                  <Label htmlFor="cot-moneda">Moneda</Label>
                  <select id="cot-moneda" value={config.moneda} disabled={!editable}
                    onChange={(e) => cambiar({ moneda: e.target.value as "MXN" | "USD" })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    <option value="MXN">Pesos (MXN)</option>
                    <option value="USD">Dólares (USD)</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={config.preciosConIva} onCheckedChange={(v) => cambiar({ preciosConIva: v })}
                  label="Mis precios ya incluyen IVA" disabled={!editable} />
                <span className="text-sm">Mis precios ya incluyen IVA</span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cot-pago">Forma de pago</Label>
                <Input id="cot-pago" value={config.formaPago} maxLength={300} disabled={!editable}
                  onChange={(e) => cambiar({ formaPago: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cot-condiciones">Otras condiciones (salen al final del PDF)</Label>
                <Textarea id="cot-condiciones" rows={3} maxLength={1500} value={config.condiciones} disabled={!editable}
                  placeholder="Tiempo de entrega, garantía, qué incluye la instalación…"
                  onChange={(e) => cambiar({ condiciones: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cot-mensaje">Mensaje que acompaña al PDF en WhatsApp</Label>
                <Textarea id="cot-mensaje" rows={2} maxLength={600} value={config.mensaje} disabled={!editable}
                  onChange={(e) => cambiar({ mensaje: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  Usa <code>{"{nombre}"}</code>, <code>{"{folio}"}</code>, <code>{"{total}"}</code> y{" "}
                  <code>{"{vigencia}"}</code>. Solo sale si el cliente te escribió en las últimas 24 h.
                </p>
              </div>
            </section>
            {botonGuardar}
          </>
        )}

        {pestana === "seguimiento" && (
          <>
            <section className="space-y-3">
              <div className="flex items-start gap-3">
                <Switch checked={config.detectarSi} onCheckedChange={(v) => cambiar({ detectarSi: v })}
                  label="Avisarme cuando el cliente diga que sí" disabled={!editable} />
                <div>
                  <p className="text-sm font-medium">Avisarme cuando el cliente diga que sí</p>
                  <p className="text-xs text-muted-foreground">
                    Si después de recibir la cotización el cliente escribe algo como «va, lo quiero» o «¿a qué cuenta
                    deposito?», el botón «Cotizar» de la bandeja se pone verde con «¿Aceptó?» para que la marques
                    aceptada con un clic. Nunca la acepta sola. Usa la IA de Ajustes → IA (el modelo barato).
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <div className="flex items-start gap-3">
                <Switch checked={config.seguimiento.activo} onCheckedChange={(v) => cambiarSeguimiento({ activo: v })}
                  label="Seguimiento a cotizaciones sin respuesta" disabled={!editable} />
                <div>
                  <p className="text-sm font-medium">Seguimiento a cotizaciones sin respuesta</p>
                  <p className="text-xs text-muted-foreground">
                    Si el cliente no contesta nada después de recibir la cotización, se le escribe solo. Se detiene en
                    cuanto contesta, la marcas aceptada o rechazada, vence, o lo detienes en la cotización.
                  </p>
                </div>
              </div>

              {config.seguimiento.activo && (
                <div className="space-y-4 rounded-md border p-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Switch checked={config.seguimiento.conTexto}
                        onCheckedChange={(v) => cambiarSeguimiento({ conTexto: v })}
                        label="Primer recordatorio con texto normal" disabled={!editable} />
                      <span className="text-sm font-medium">1. Recordatorio antes de que se cierre la ventana de 24 h</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Sale como mensaje normal (sin plantilla, sin costo) unas 2 horas antes de que se cumplan 24 h
                      del último mensaje del cliente.
                    </p>
                    {config.seguimiento.conTexto && (
                      <>
                        <Textarea id="cot-seg-texto" rows={2} maxLength={600} value={config.seguimiento.texto}
                          disabled={!editable} aria-label="Texto del primer recordatorio"
                          onChange={(e) => cambiarSeguimiento({ texto: e.target.value })} />
                        <p className="text-xs text-muted-foreground">
                          Usa <code>{"{nombre}"}</code>, <code>{"{producto}"}</code> y <code>{"{folio}"}</code>.
                        </p>
                      </>
                    )}
                  </div>

                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">2. Recordatorio con plantilla</p>
                    <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                      <Numero label="A los (días)" value={config.seguimiento.dias} min={1} max={30} disabled={!editable}
                        onChange={(v) => cambiarSeguimiento({ dias: v })} />
                      <div className="space-y-1.5">
                        <Label htmlFor="cot-seg-plantilla">Plantilla</Label>
                        <select id="cot-seg-plantilla" value={config.seguimiento.plantillaId ?? ""} disabled={!editable}
                          onChange={(e) => cambiarSeguimiento({ plantillaId: e.target.value || null })}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                          <option value="">Sin plantilla: solo sale el primer recordatorio</option>
                          {(datos.plantillas ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.language} · {p.category})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Pasadas 24 h, WhatsApp solo deja mandar plantillas aprobadas. Da de alta una en{" "}
                      <Link href="/settings/templates" className="font-medium text-brand-text underline underline-offset-2">
                        Plantillas
                      </Link>{" "}
                      (categoría Marketing), por ejemplo: «{PLANTILLA_SEGUIMIENTO_SUGERIDA}». {"{{1}}"} es el nombre
                      y {"{{2}}"} el producto.
                    </p>
                  </div>
                </div>
              )}
            </section>
            {botonGuardar}
          </>
        )}

        {pestana === "negocio" && (
          <>
            <section className="space-y-3">
              <p className="text-sm text-muted-foreground">Lo que sale en el encabezado del PDF.</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-md border bg-subtle">
                  {datos.tieneLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/settings/cotizaciones/logo?v=${logoVersion}`}
                      alt="Logo de la cotización"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin logo</span>
                  )}
                </div>
                {editable && (
                  <div className="flex gap-2">
                    <input
                      ref={archivo}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void subirLogo(f);
                        e.target.value = "";
                      }}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => archivo.current?.click()}>
                      <ImagePlus className="mr-1 h-4 w-4" aria-hidden /> {datos.tieneLogo ? "Cambiar logo" : "Subir logo"}
                    </Button>
                    {datos.tieneLogo && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => void quitarLogo()}>
                        Quitar
                      </Button>
                    )}
                  </div>
                )}
                <span className="text-xs text-muted-foreground">PNG o JPG, hasta 300 KB.</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Nombre comercial" value={config.negocio.nombre} disabled={!editable}
                  onChange={(v) => cambiarNegocio({ nombre: v })} placeholder="Si lo dejas vacío, el de Marca" />
                <Campo label="RFC (opcional)" value={config.negocio.rfc} disabled={!editable}
                  onChange={(v) => cambiarNegocio({ rfc: v })} />
                <Campo label="Dirección" value={config.negocio.direccion} disabled={!editable}
                  onChange={(v) => cambiarNegocio({ direccion: v })} />
                <Campo label="Teléfono" value={config.negocio.telefono} disabled={!editable}
                  onChange={(v) => cambiarNegocio({ telefono: v })} />
                <Campo label="Correo" value={config.negocio.correo} disabled={!editable}
                  onChange={(v) => cambiarNegocio({ correo: v })} />
              </div>
            </section>
            {botonGuardar}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function EstadoChip({ estado }: { estado: CotizacionDto["estado"] }) {
  const info = ESTADO_INFO[estado];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${info.color}22`, color: info.color }}
    >
      {info.etiqueta}
    </span>
  );
}

function Campo(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = `cot-${props.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <Input id={id} value={props.value} disabled={props.disabled} placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

function Numero(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const id = `cot-${props.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <NumeroInput id={id} min={props.min} max={props.max} value={props.value} disabled={props.disabled}
        onValueChange={props.onChange} />
    </div>
  );
}
