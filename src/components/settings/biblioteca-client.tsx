"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileText, ImageIcon, Pencil, Trash2, Upload, Video, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ACEPTA,
  MAX_CUANDO,
  MAX_TITULO,
  detectarMime,
  pesoLegible,
  problemaDelArchivo,
  problemaDelLote,
  type ArchivoDto,
} from "@/lib/biblioteca";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Biblioteca: las fotos,
 * videos y fichas que el agente manda por WhatsApp cuando el cliente quiere
 * ver algo. El título y el «cuándo mandarlo» son lo que el agente lee para
 * elegir.
 */

type Datos = {
  archivos: ArchivoDto[];
  productos: string[];
  puedeEditar: boolean;
  maxArchivos: number;
  maxPartes: number;
};
type Aviso = { ok: boolean; texto: string } | null;

const ICONO = { foto: ImageIcon, video: Video, documento: FileText } as const;
const NOMBRE_TIPO = { foto: "Foto", video: "Video", documento: "PDF" } as const;

export function BibliotecaClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/biblioteca").catch(() => null);
    if (!res?.ok) return setAviso({ ok: false, texto: "No se pudo cargar la biblioteca" });
    setDatos((await res.json()) as Datos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos) return aviso ? <p className="text-sm text-danger-text">{aviso.texto}</p> : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Biblioteca</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Fotos, videos y fichas que el agente manda por WhatsApp cuando el cliente quiere ver algo: un modelo, un
          acabado, una instalación terminada. El agente elige por el <strong>título</strong> y por{" "}
          <strong>cuándo mandarlo</strong>, así que escríbelos claros.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Para que los use, enciende «Mandar fotos y videos» en{" "}
          <Link href="/agent" className="font-medium text-brand-text underline underline-offset-2">
            Agente → Rol
          </Link>
          . Solo se mandan por WhatsApp, con la ventana de 24 horas abierta.
        </p>
      </div>

      {datos.puedeEditar && (
        <Subir
          lleno={datos.archivos.length >= datos.maxArchivos}
          maxArchivos={datos.maxArchivos}
          maxPartes={datos.maxPartes ?? 10}
          productos={datos.productos ?? []}
          onSubido={() => void cargar()}
        />
      )}

      {aviso && (
        <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
          {aviso.texto}
        </p>
      )}

      {datos.archivos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Todavía no hay archivos. Sube tu primera foto, video o ficha técnica.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {datos.archivos.map((a) => (
            <Tarjeta
              key={a.id}
              archivo={a}
              editable={datos.puedeEditar}
              productos={datos.productos ?? []}
              onCambio={() => void cargar()}
              onAviso={setAviso}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {datos.archivos.length} de {datos.maxArchivos} archivos. Se guardan en el servidor del CRM.
      </p>
    </div>
  );
}

/** Lo que se le sugiere al agente al elegir un producto, si «cuándo» está vacío. */
function cuandoDelProducto(producto: string): string {
  return `Cuando pregunten por el ${producto}, pidan fotos o quieran ver cómo se ve.`.slice(0, MAX_CUANDO);
}

/**
 * El título: se escribe o se elige de la lista de productos (Ajustes →
 * Cotizaciones). Al hacer clic se abre la lista; al escribir, se filtra.
 */
function TituloConProductos({
  id,
  value,
  productos,
  onChange,
  onElegir,
}: {
  id?: string;
  value: string;
  productos: string[];
  onChange: (v: string) => void;
  onElegir: (producto: string) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const filtro = value.trim().toLowerCase();
  const visibles = productos.filter((p) => !filtro || p.toLowerCase().includes(filtro));
  const lista = visibles.length > 0 ? visibles : productos;

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        maxLength={MAX_TITULO}
        autoComplete="off"
        placeholder={productos.length > 0 ? "Elige un producto o escribe el título" : "Ventanal Panorámico, de noche"}
        aria-label="Título"
        role={productos.length > 0 ? "combobox" : undefined}
        aria-expanded={productos.length > 0 ? abierta : undefined}
        className={productos.length > 0 ? "pr-9" : undefined}
        onFocus={() => setAbierta(true)}
        onClick={() => setAbierta(true)}
        onBlur={() => setAbierta(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAbierta(false);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierta(true);
        }}
      />
      {productos.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Ver productos"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            setAbierta((v) => !v);
          }}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      {abierta && productos.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {lista.map((p) => (
            <li key={p}>
              <button
                type="button"
                role="option"
                aria-selected={p === value}
                className={cn(
                  "w-full rounded px-2 py-1.5 text-left hover:bg-muted",
                  p === value && "bg-muted font-medium"
                )}
                // mousedown y no click: el blur del campo cerraría la lista antes.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onElegir(p);
                  setAbierta(false);
                }}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Elegido = { file: File; url: string | null };

function Subir({
  lleno,
  maxArchivos,
  maxPartes,
  productos,
  onSubido,
}: {
  lleno: boolean;
  maxArchivos: number;
  maxPartes: number;
  productos: string[];
  onSubido: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [elegidos, setElegidos] = useState<Elegido[]>([]);
  const [titulo, setTitulo] = useState("");
  const [cuando, setCuando] = useState("");
  // El «cuándo» que se llenó solo al elegir un producto: si nadie lo tocó,
  // cambia con el producto; si lo escribieron a mano, se respeta.
  const [cuandoAuto, setCuandoAuto] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Las miniaturas viven en memoria del navegador: se sueltan al salir.
  const elegidosRef = useRef(elegidos);
  elegidosRef.current = elegidos;
  useEffect(
    () => () => {
      for (const e of elegidosRef.current) if (e.url) URL.revokeObjectURL(e.url);
    },
    []
  );

  function limpiarInput() {
    if (input.current) input.current.value = "";
  }

  async function agregar(lista: FileList | null) {
    setError(null);
    setListo(false);
    const nuevos: Elegido[] = [];
    const problemas: string[] = [];
    for (const f of Array.from(lista ?? [])) {
      // Se revisa aquí lo mismo que en el servidor, para no esperar la subida.
      const cabeza = new Uint8Array(await f.slice(0, 16).arrayBuffer());
      const mime = detectarMime(cabeza);
      const problema = problemaDelArchivo(mime, f.size);
      if (problema) {
        problemas.push(`«${f.name}»: ${problema}`);
        continue;
      }
      nuevos.push({ file: f, url: mime?.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    limpiarInput();
    const cupo = maxPartes - elegidos.length;
    const entran = nuevos.slice(0, Math.max(0, cupo));
    for (const e of nuevos.slice(entran.length)) if (e.url) URL.revokeObjectURL(e.url);
    if (nuevos.length > entran.length) problemas.push(`Máximo ${maxPartes} archivos por producto.`);
    if (entran.length > 0) setElegidos((prev) => [...prev, ...entran]);
    if (problemas.length > 0) setError(problemas.join(" "));
  }

  function quitar(i: number) {
    setElegidos((prev) => {
      const e = prev[i];
      if (e?.url) URL.revokeObjectURL(e.url);
      return prev.filter((_, j) => j !== i);
    });
  }

  function elegirProducto(p: string) {
    setTitulo(p.slice(0, MAX_TITULO));
    if (!cuando.trim() || cuando === cuandoAuto) {
      const sugerido = cuandoDelProducto(p);
      setCuando(sugerido);
      setCuandoAuto(sugerido);
    }
  }

  const pesoTotal = elegidos.reduce((t, e) => t + e.file.size, 0);
  const problemaLote = elegidos.length > 0 ? problemaDelLote(elegidos.map((e) => e.file.size)) : null;

  async function subir() {
    if (!titulo.trim()) return setError("Ponle un título");
    if (elegidos.length === 0) return setError("Elige al menos una foto, un video o un PDF");
    if (problemaLote) return setError(problemaLote);
    setSubiendo(true);
    setError(null);
    const form = new FormData();
    form.set("titulo", titulo.trim());
    form.set("cuando", cuando.trim());
    for (const e of elegidos) form.append("archivo", e.file);
    const res = await fetch("/api/settings/biblioteca", { method: "POST", body: form }).catch(() => null);
    setSubiendo(false);
    if (!res?.ok) {
      const j = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(j?.error?.message ?? "No se pudo subir. Revisa tu conexión e inténtalo otra vez.");
    }
    for (const e of elegidos) if (e.url) URL.revokeObjectURL(e.url);
    setElegidos([]);
    setTitulo("");
    setCuando("");
    setCuandoAuto(null);
    limpiarInput();
    setListo(true);
    onSubido();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subir producto</CardTitle>
        <CardDescription>
          Hasta {maxPartes} fotos o videos del mismo producto: el agente los manda todos juntos. Foto JPG o PNG (hasta 5
          MB), video MP4 (hasta 16 MB) o PDF (hasta 20 MB).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lleno ? (
          <p className="text-sm text-warning-text">
            La biblioteca ya tiene {maxArchivos} productos. Borra alguno para subir otro.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="bib-titulo">Título</Label>
              <TituloConProductos
                id="bib-titulo"
                value={titulo}
                productos={productos}
                onChange={setTitulo}
                onElegir={elegirProducto}
              />
              {productos.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Si das de alta tus productos en{" "}
                  <Link href="/settings/cotizaciones" className="underline underline-offset-2">
                    Ajustes → Cotizaciones
                  </Link>
                  , aquí los eliges con un clic.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bib-cuando">¿Cuándo debe mandarlo el agente?</Label>
              <Textarea
                id="bib-cuando"
                rows={2}
                value={cuando}
                maxLength={MAX_CUANDO}
                placeholder="Cuando pregunten por el Ventanal Panorámico, por la vista o quieran verlo de noche."
                onChange={(e) => setCuando(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bib-archivo">
                Fotos o videos{" "}
                <span className="font-normal text-muted-foreground">
                  ({elegidos.length} de {maxPartes})
                </span>
              </Label>
              <input
                ref={input}
                id="bib-archivo"
                type="file"
                multiple
                accept={ACEPTA}
                className="sr-only"
                disabled={elegidos.length >= maxPartes}
                onChange={(e) => void agregar(e.target.files)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={elegidos.length >= maxPartes}
                  onClick={() => input.current?.click()}
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  {elegidos.length === 0 ? "Elegir fotos o videos" : "Agregar más"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {elegidos.length === 0
                    ? "Ningún archivo elegido"
                    : `${elegidos.length} ${elegidos.length === 1 ? "elegido" : "elegidos"}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Puedes elegir varias a la vez (mantén Ctrl o toca varias en el celular) o agregarlas de una en una.
              </p>
              {elegidos.length > 0 && (
                <>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {elegidos.map((e, i) => {
                      const Icono = e.file.type.startsWith("video") ? Video : FileText;
                      return (
                        <li key={`${e.file.name}-${i}`} className="relative">
                          {e.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.url} alt={e.file.name} className="h-20 w-full rounded-md bg-muted object-cover" />
                          ) : (
                            <div className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-md bg-muted px-1 text-center text-[10px] text-muted-foreground">
                              <Icono className="h-5 w-5" />
                              <span className="line-clamp-2 break-all">{e.file.name}</span>
                            </div>
                          )}
                          {i === 0 && (
                            <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[10px] font-medium">
                              Principal
                            </span>
                          )}
                          <button
                            type="button"
                            aria-label={`Quitar ${e.file.name}`}
                            className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-muted-foreground hover:text-foreground"
                            onClick={() => quitar(i)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className={cn("text-xs", problemaLote ? "text-danger-text" : "text-muted-foreground")}>
                    {problemaLote ?? `${elegidos.length} ${elegidos.length === 1 ? "archivo" : "archivos"} · ${pesoLegible(pesoTotal)}`}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void subir()}
                disabled={subiendo || elegidos.length === 0 || !titulo.trim() || Boolean(problemaLote)}
              >
                <Upload className="mr-2 h-4 w-4" />
                {subiendo
                  ? "Subiendo…"
                  : elegidos.length > 1
                    ? `Subir ${elegidos.length} archivos`
                    : "Subir"}
              </Button>
              {error && <span className="text-sm text-danger-text">{error}</span>}
              {listo && !error && <span className="text-sm text-success-text">Listo: ya está en la biblioteca.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Vista({ archivo }: { archivo: ArchivoDto }) {
  const [n, setN] = useState(0);
  const partes = archivo.partes ?? [{ n: 0, tipo: archivo.tipo, tamano: archivo.tamano }];
  const actual = partes[n] ?? partes[0]!;
  if (partes.length <= 1) return <VistaParte archivo={archivo} n={0} tipo={archivo.tipo} />;
  return (
    <div className="space-y-2">
      <VistaParte archivo={archivo} n={actual.n} tipo={actual.tipo} />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {partes.map((p) => (
          <button
            key={p.n}
            type="button"
            aria-label={`Ver archivo ${p.n + 1} de ${partes.length}`}
            className={cn(
              "h-12 w-12 shrink-0 overflow-hidden rounded border-2",
              p.n === actual.n ? "border-brand" : "border-transparent opacity-70 hover:opacity-100"
            )}
            onClick={() => setN(p.n)}
          >
            {p.tipo === "foto" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/settings/biblioteca/${archivo.id}/archivo?n=${p.n}`}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                {p.tipo === "video" ? <Video className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function VistaParte({ archivo, n, tipo }: { archivo: ArchivoDto; n: number; tipo: ArchivoDto["tipo"] }) {
  const url = `/api/settings/biblioteca/${archivo.id}/archivo${n > 0 ? `?n=${n}` : ""}`;
  if (tipo === "foto") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={archivo.titulo} className="h-44 w-full rounded-md bg-muted object-cover" loading="lazy" />;
  }
  if (tipo === "video") {
    return <video src={url} controls preload="metadata" className="h-44 w-full rounded-md bg-black object-contain" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-sm text-muted-foreground hover:text-foreground"
    >
      <FileText className="h-10 w-10" />
      Abrir PDF
    </a>
  );
}

function Tarjeta({
  archivo,
  editable,
  productos,
  onCambio,
  onAviso,
}: {
  archivo: ArchivoDto;
  editable: boolean;
  productos: string[];
  onCambio: () => void;
  onAviso: (a: Aviso) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(archivo.titulo);
  const [cuando, setCuando] = useState(archivo.cuando);
  const [ocupado, setOcupado] = useState(false);
  const Icono = ICONO[archivo.tipo];

  async function cambiar(cambios: Partial<Pick<ArchivoDto, "titulo" | "cuando" | "activo">>) {
    setOcupado(true);
    const res = await fetch(`/api/settings/biblioteca/${archivo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cambios),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      const j = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      onAviso({ ok: false, texto: j?.error?.message ?? "No se pudo guardar el cambio" });
      return false;
    }
    onAviso(null);
    onCambio();
    return true;
  }

  async function borrar() {
    if (!window.confirm(`¿Borrar «${archivo.titulo}»? El agente ya no lo podrá mandar.`)) return;
    setOcupado(true);
    const res = await fetch(`/api/settings/biblioteca/${archivo.id}`, { method: "DELETE" }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) return onAviso({ ok: false, texto: "No se pudo borrar el archivo" });
    onAviso({ ok: true, texto: `Se borró «${archivo.titulo}».` });
    onCambio();
  }

  return (
    <Card className={cn(!archivo.activo && "opacity-60")}>
      <CardContent className="space-y-3 p-4">
        <Vista archivo={archivo} />
        {editando ? (
          <div className="space-y-2">
            <TituloConProductos
              value={titulo}
              productos={productos}
              onChange={setTitulo}
              onElegir={(p) => setTitulo(p.slice(0, MAX_TITULO))}
            />
            <Textarea
              rows={2}
              value={cuando}
              maxLength={MAX_CUANDO}
              aria-label="Cuándo mandarlo"
              placeholder="¿Cuándo debe mandarlo el agente?"
              onChange={(e) => setCuando(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={ocupado || !titulo.trim()}
                onClick={async () => {
                  if (await cambiar({ titulo: titulo.trim(), cuando: cuando.trim() })) setEditando(false);
                }}
              >
                Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTitulo(archivo.titulo);
                  setCuando(archivo.cuando);
                  setEditando(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <Icono className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="font-medium leading-snug">{archivo.titulo}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {archivo.cuando || <em>Sin indicación de cuándo mandarlo.</em>}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">
            {(archivo.cantidad ?? 1) > 1 ? `${archivo.cantidad} archivos` : NOMBRE_TIPO[archivo.tipo]}
          </Badge>
          <span>{pesoLegible(archivo.tamano)}</span>
          <span>·</span>
          <span>
            {archivo.envios === 0 ? "No se ha mandado" : `Mandado ${archivo.envios} ${archivo.envios === 1 ? "vez" : "veces"}`}
          </span>
        </div>
        {editable && !editando && (
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <div className="flex items-center gap-2 text-sm">
              <Switch
                checked={archivo.activo}
                onCheckedChange={(v) => void cambiar({ activo: v })}
                label={`El agente puede mandar «${archivo.titulo}»`}
                disabled={ocupado}
                size="sm"
              />
              <span>{archivo.activo ? "Activo" : "Apagado"}</span>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditando(true)} disabled={ocupado}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void borrar()} disabled={ocupado}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Borrar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
