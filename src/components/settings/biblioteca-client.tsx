"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, ImageIcon, Pencil, Trash2, Upload, Video } from "lucide-react";
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
  type ArchivoDto,
} from "@/lib/biblioteca";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Biblioteca: las fotos,
 * videos y fichas que el agente manda por WhatsApp cuando el cliente quiere
 * ver algo. El título y el «cuándo mandarlo» son lo que el agente lee para
 * elegir.
 */

type Datos = { archivos: ArchivoDto[]; puedeEditar: boolean; maxArchivos: number };
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

function Subir({ lleno, maxArchivos, onSubido }: { lleno: boolean; maxArchivos: number; onSubido: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState("");
  const [cuando, setCuando] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function elegir(f: File | null) {
    setError(null);
    setListo(false);
    setArchivo(null);
    if (!f) return;
    // Se revisa aquí lo mismo que en el servidor, para no esperar la subida.
    const cabeza = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    const problema = problemaDelArchivo(detectarMime(cabeza), f.size);
    if (problema) {
      setError(problema);
      if (input.current) input.current.value = "";
      return;
    }
    setArchivo(f);
    if (!titulo.trim()) setTitulo(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, MAX_TITULO));
  }

  async function subir() {
    if (!archivo) return setError("Elige un archivo");
    if (!titulo.trim()) return setError("Ponle un título");
    setSubiendo(true);
    setError(null);
    const form = new FormData();
    form.set("archivo", archivo);
    form.set("titulo", titulo.trim());
    form.set("cuando", cuando.trim());
    const res = await fetch("/api/settings/biblioteca", { method: "POST", body: form }).catch(() => null);
    setSubiendo(false);
    if (!res?.ok) {
      const j = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(j?.error?.message ?? "No se pudo subir el archivo");
    }
    setArchivo(null);
    setTitulo("");
    setCuando("");
    if (input.current) input.current.value = "";
    setListo(true);
    onSubido();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subir archivo</CardTitle>
        <CardDescription>Foto JPG o PNG (hasta 5 MB), video MP4 (hasta 16 MB) o PDF (hasta 20 MB).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lleno ? (
          <p className="text-sm text-warning-text">
            La biblioteca ya tiene {maxArchivos} archivos. Borra alguno para subir otro.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="bib-archivo">Archivo</Label>
              <Input
                ref={input}
                id="bib-archivo"
                type="file"
                accept={ACEPTA}
                onChange={(e) => void elegir(e.target.files?.[0] ?? null)}
              />
              {archivo && (
                <p className="text-xs text-muted-foreground">
                  {archivo.name} · {pesoLegible(archivo.size)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bib-titulo">Título</Label>
              <Input
                id="bib-titulo"
                value={titulo}
                maxLength={MAX_TITULO}
                placeholder="Ventanal Panorámico, de noche"
                onChange={(e) => setTitulo(e.target.value)}
              />
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
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void subir()} disabled={subiendo || !archivo}>
                <Upload className="mr-2 h-4 w-4" />
                {subiendo ? "Subiendo…" : "Subir"}
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
  const url = `/api/settings/biblioteca/${archivo.id}/archivo`;
  if (archivo.tipo === "foto") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={archivo.titulo} className="h-44 w-full rounded-md bg-muted object-cover" loading="lazy" />;
  }
  if (archivo.tipo === "video") {
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
  onCambio,
  onAviso,
}: {
  archivo: ArchivoDto;
  editable: boolean;
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
            <Input
              value={titulo}
              maxLength={MAX_TITULO}
              aria-label="Título"
              onChange={(e) => setTitulo(e.target.value)}
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
          <Badge variant="secondary">{NOMBRE_TIPO[archivo.tipo]}</Badge>
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
