"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/results/section";
import {
  CATEGORIAS,
  GRATIS_SERVICIO,
  NOMBRE_CATEGORIA,
  TARIFAS_MX,
  TARIFAS_VIGENCIA,
  type ConfigContador,
  type Estado,
  type ResumenDto,
} from "@/lib/contador-mensajes";

/**
 * Módulo de la agencia (Treviño AI) — Resultados → Mensajes de WhatsApp.
 * Cuántos mensajes manda el número este mes, cuántos fueron gratis, cuánto va
 * a cobrar Meta y cuándo avisarle al dueño.
 */

const n = (x: number) => x.toLocaleString("es-MX");
const dinero = (x: number) =>
  x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ESTADO: Record<Estado, { texto: string; chip: string; barra: string }> = {
  bien: { texto: "Bien", chip: "bg-success-tint text-success-text", barra: "bg-success" },
  cerca: { texto: "Cerca del límite", chip: "bg-warning-tint text-warning-text", barra: "bg-warning" },
  cobra: { texto: "Ya se cobran", chip: "bg-info-tint text-info-text", barra: "bg-info" },
  no_entrega: { texto: "Meta no está entregando", chip: "bg-danger-tint text-danger-text", barra: "bg-danger" },
};

function hace(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

export function ContadorMensajes() {
  const [d, setD] = useState<ResumenDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigContador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pidiendo, setPidiendo] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/results/mensajes").catch(() => null);
    if (!res?.ok) return setError("No se pudo calcular. Intenta de nuevo en un momento.");
    const dto = (await res.json()) as ResumenDto;
    setD(dto);
    setConfig(dto.config);
    setError(null);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/results/mensajes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const e = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setAviso({ ok: false, texto: e?.error?.message ?? "No se pudo guardar" });
    }
    setAviso({ ok: true, texto: "Guardado" });
    void cargar();
  }

  async function pedirAMeta() {
    setPidiendo(true);
    await fetch("/api/results/mensajes", { method: "POST" }).catch(() => null);
    setPidiendo(false);
    void cargar();
  }

  const cargando = !d && !error;
  const est = d ? ESTADO[d.estado] : ESTADO.bien;
  const pct = d ? Math.min(d.servicio.usadas / GRATIS_SERVICIO, 1) : 0;
  const maxDia = d ? Math.max(1, ...d.porDia.map((x) => x.nea + x.personas + x.plantillas)) : 1;

  return (
    <div className="flex h-full flex-col" data-contador-mensajes>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <Link href="/results" className="mb-1 inline-flex items-center gap-1 text-xs text-text-3 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Resultados
          </Link>
          <h2 className="text-[17px] font-bold tracking-tight">Mensajes de WhatsApp</h2>
          <p className="text-xs text-text-3">Cuántos mensajes manda tu número este mes y cuánto te va a cobrar Meta.</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6">
        {d?.estado === "no_entrega" && (
          <div role="alert" className="rounded-lg border border-danger-soft bg-danger-tint px-4 py-3 text-sm text-danger-text">
            <b>Meta no está entregando mensajes por un problema de pago</b> ({n(d.fallosPago)} este mes). Tus clientes
            no reciben las respuestas aunque en el CRM se vean enviadas. Revisa la tarjeta en business.facebook.com →
            Facturación y pagos, en la cuenta de WhatsApp de este número.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Section
              title="Respuestas gratis del mes"
              hint={`Meta regala ${n(GRATIS_SERVICIO)} respuestas al mes por número. Se reinician el día 1.`}
              loading={cargando}
              error={error}
              hasData={!!d}
              right={d && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", est.chip)}>{est.texto}</span>}
            >
              {d && (
                <div className="space-y-3">
                  <p className="text-3xl font-bold tabular-nums">
                    {n(d.servicio.usadas)} <span className="text-base font-medium text-text-3">de {n(GRATIS_SERVICIO)}</span>
                  </p>
                  <div className="relative h-3 rounded-full border bg-subtle" aria-hidden>
                    <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", est.barra)} style={{ width: `${pct * 100}%` }} />
                    <div className="absolute -inset-y-1 w-0.5 bg-text-3" style={{ left: `${d.config.alertaPct}%` }} title="Aviso" />
                  </div>
                  <div className="flex justify-between font-mono text-[11px] text-text-3">
                    <span>0</span>
                    <span>aviso al {d.config.alertaPct}%</span>
                    <span>{n(GRATIS_SERVICIO)}</span>
                  </div>
                  <p className="text-sm text-text-2">
                    {d.servicio.usadas >= GRATIS_SERVICIO
                      ? `Se acabaron las gratis: ${n(d.servicio.cobradas)} respuestas ya se cobran. A este ritmo cerrarás el mes con unas ${n(d.proyeccion.respuestas)}.`
                      : d.proyeccion.diaQueSeAcaban
                        ? `Te quedan ${n(GRATIS_SERVICIO - d.servicio.usadas)}. A este ritmo se acaban el día ${d.proyeccion.diaQueSeAcaban}.`
                        : `Te quedan ${n(GRATIS_SERVICIO - d.servicio.usadas)}. A este ritmo te alcanzan todo el mes.`}
                  </p>
                  {(d.fueraDelCrm.respuestas > 0 || d.fueraDelCrm.plantillas > 0) && (
                    <p className="rounded-md bg-subtle px-3 py-2 text-xs text-text-2">
                      Incluye {n(d.fueraDelCrm.respuestas)} respuestas
                      {d.fueraDelCrm.plantillas > 0 && ` y ${n(d.fueraDelCrm.plantillas)} plantillas`} que Meta contó y
                      ya no están en el CRM (conversaciones borradas o mensajes enviados por fuera). Se suman porque Meta
                      cobra lo que ella cuenta; no salen en la gráfica por día.
                    </p>
                  )}
                </div>
              )}
            </Section>
          </div>

          <div className="lg:col-span-5">
            <Section title="Costo de Meta" hint="Estimado con la tabla de precios, al momento." loading={cargando} error={error} hasData={!!d}>
              {d && (
                <div className="space-y-3">
                  <p className="text-3xl font-bold tabular-nums">
                    ${dinero(d.costo)} <span className="text-base font-medium text-text-3">MXN este mes</span>
                  </p>
                  <p className="text-xs text-text-3">Si sigue igual, el mes cerraría en unos ${dinero(d.proyeccion.costo)}.</p>
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="text-left text-xs text-text-3">
                        <th className="pb-1 font-medium">Qué</th>
                        <th className="pb-1 text-right font-medium">Cuántos</th>
                        <th className="pb-1 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="py-1.5">Respuestas gratis</td>
                        <td className="text-right">{n(d.servicio.gratis)}</td>
                        <td className="text-right">$0.00</td>
                      </tr>
                      {d.desglose
                        .filter((x) => x.categoria === "service" || x.cantidad > 0)
                        .map((x) => (
                          <tr key={x.categoria} className="border-t">
                            <td className="py-1.5">
                              {x.categoria === "service" ? "Respuestas que se cobran" : NOMBRE_CATEGORIA[x.categoria]}
                            </td>
                            <td className="text-right">{n(x.cantidad)}</td>
                            <td className="text-right">${dinero(x.total)}</td>
                          </tr>
                        ))}
                      <tr className="border-t-2 font-bold">
                        <td className="py-1.5" colSpan={2}>Total</td>
                        <td className="text-right">${dinero(d.costo)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-xs text-text-3">
                    Lo que te escriben tus clientes no cuesta: este mes llevas {n(d.recibidos)} mensajes recibidos.
                  </p>
                </div>
              )}
            </Section>
          </div>
        </div>

        <Section
          title="Según el reporte de Meta"
          hint="El conteo y el costo oficiales. Meta los publica con unas horas de retraso."
          loading={cargando}
          error={error}
          hasData={!!d}
          right={
            d?.puedeEditar && (
              <Button variant="outline" size="sm" onClick={() => void pedirAMeta()} disabled={pidiendo}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", pidiendo && "animate-spin")} /> Actualizar ahora
              </Button>
            )
          }
        >
          {d &&
            (d.oficial ? (
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <p>
                  <span className="block text-xs text-text-3">Costo cobrado</span>
                  <b className="text-lg tabular-nums">
                    ${dinero(d.oficial.costo)} {d.oficial.moneda ?? ""}
                  </b>
                </p>
                <p>
                  <span className="block text-xs text-text-3">Respuestas</span>
                  <b className="text-lg tabular-nums">{n(d.oficial.respuestas)}</b>
                </p>
                <p>
                  <span className="block text-xs text-text-3">Plantillas</span>
                  <b className="text-lg tabular-nums">{n(d.oficial.plantillas)}</b>
                </p>
                <p className="self-end text-xs text-text-3">
                  Actualizado {hace(d.oficial.actualizadoEn)}. {n(d.confirmadosPorMeta)} mensajes del CRM
                  ya traen el cobro confirmado por Meta uno por uno.
                  {!d.oficial.moneda && " Meta no reporta moneda: la cuenta no tiene tarjeta o es de prueba, y no cobra."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-text-3">Todavía no llega el reporte de Meta de este mes.</p>
            ))}
        </Section>

        <Section
          title="Mensajes por día"
          hint="Solo los entregados, que son los que Meta cobra."
          loading={cargando}
          error={error}
          hasData={!!d}
          right={
            <div className="flex flex-wrap gap-3 text-xs text-text-3">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-primary" /> Nea</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-success" /> Personas</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-warning" /> Plantillas</span>
            </div>
          }
        >
          {d && (
            <div>
              <div className="flex h-32 items-end gap-[3px] border-b" aria-label="Mensajes por día del mes">
                {d.porDia.map((x) => {
                  const total = x.nea + x.personas + x.plantillas;
                  const h = (v: number) => `${(v / maxDia) * 100}%`;
                  return (
                    <div
                      key={x.dia}
                      title={`Día ${x.dia}: ${total} (Nea ${x.nea}, personas ${x.personas}, plantillas ${x.plantillas})`}
                      className={cn(
                        "flex h-full min-w-0 flex-1 flex-col-reverse",
                        x.dia > d.dia && "opacity-30",
                        x.dia === d.dia && "rounded-sm outline outline-2 outline-offset-1 outline-primary"
                      )}
                    >
                      <i className="block w-full bg-primary" style={{ height: h(x.nea) }} />
                      <i className="block w-full bg-success" style={{ height: h(x.personas) }} />
                      <i className="block w-full bg-warning" style={{ height: h(x.plantillas) }} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[11px] text-text-3">
                <span>1</span>
                <span>{d.diasMes}</span>
              </div>
            </div>
          )}
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="¿Quién manda los mensajes?"
            hint="Para saber dónde ahorrar: por ejemplo, que Nea conteste en un solo mensaje."
            loading={cargando}
            error={error}
            hasData={!!d}
          >
            {d && (
              <div className="space-y-2.5">
                {(
                  [
                    ["Nea", d.porOrigen.nea, "bg-primary"],
                    ["Personas", d.porOrigen.personas, "bg-success"],
                    ["Plantillas", d.porOrigen.plantillas, "bg-warning"],
                    ...(d.fueraDelCrm.respuestas + d.fueraDelCrm.plantillas > 0
                      ? ([["Sin detalle", d.fueraDelCrm.respuestas + d.fueraDelCrm.plantillas, "bg-text-3"]] as const)
                      : []),
                  ] as const
                ).map(([k, v, c]) => {
                  const max = Math.max(1, d.porOrigen.nea, d.porOrigen.personas, d.porOrigen.plantillas);
                  return (
                    <div key={k} className="grid grid-cols-[90px_1fr_60px] items-center gap-3 text-sm">
                      <span>{k}</span>
                      <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
                        <i className={cn("block h-full rounded-full", c)} style={{ width: `${(v / max) * 100}%` }} />
                      </div>
                      <span className="text-right tabular-nums text-text-3">{n(v)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title="Avisos y precios"
            hint="Cuándo avisarle al dueño y con qué tarifas se estima el costo."
            loading={cargando}
            error={error}
            hasData={!!d && !!config}
          >
            {d && config && (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span>Avisar al llegar a</span>
                  <select
                    aria-label="Porcentaje para avisar"
                    value={config.alertaPct}
                    disabled={!d.puedeEditar}
                    onChange={(e) => setConfig({ ...config, alertaPct: Number(e.target.value) })}
                    className="h-9 rounded-md border border-input bg-background px-2"
                  >
                    {[50, 60, 70, 80, 90].map((p) => (
                      <option key={p} value={p}>
                        {p}%
                      </option>
                    ))}
                  </select>
                  <span>de las respuestas gratis.</span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contador-tel">Teléfono del dueño para el aviso por WhatsApp</Label>
                  <Input
                    id="contador-tel"
                    inputMode="tel"
                    placeholder="Ej. 528112345678 (vacío = solo aviso en el CRM)"
                    value={config.telefonoDueno ?? ""}
                    disabled={!d.puedeEditar}
                    onChange={(e) => setConfig({ ...config, telefonoDueno: e.target.value.trim() || null })}
                  />
                  <p className="text-xs text-text-3">
                    El dueño debe haberle escrito antes a este número. Si no ha escrito en 24 h, se usa la plantilla de abajo.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contador-plantilla">Plantilla para el aviso (si pasaron más de 24 h)</Label>
                  <select
                    id="contador-plantilla"
                    value={config.plantillaId ?? ""}
                    disabled={!d.puedeEditar}
                    onChange={(e) => setConfig({ ...config, plantillaId: e.target.value || null })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2"
                  >
                    <option value="">Sin plantilla</option>
                    {d.plantillasDisponibles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.language})
                      </option>
                    ))}
                  </select>
                </div>

                <details className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer select-none font-medium">
                    Tarifas de Meta (MXN por mensaje)
                  </summary>
                  <p className="mt-1 text-xs text-text-3">
                    Las de México vigentes desde el {TARIFAS_VIGENCIA}. Meta solo cambia precios el 1 de enero, abril, julio y octubre.
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {CATEGORIAS.map((c) => (
                      <label key={c} className="space-y-1 text-xs">
                        <span className="block text-text-2">{NOMBRE_CATEGORIA[c]}</span>
                        <Input
                          type="number"
                          step="0.0001"
                          min={0}
                          value={config.tarifas[c]}
                          disabled={!d.puedeEditar}
                          onChange={(e) =>
                            setConfig({ ...config, tarifas: { ...config.tarifas, [c]: Number(e.target.value) } })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {d.puedeEditar && (
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-brand-text underline underline-offset-2"
                      onClick={() => setConfig({ ...config, tarifas: { ...TARIFAS_MX } })}
                    >
                      Volver a las de octubre 2026
                    </button>
                  )}
                </details>

                {d.puedeEditar && (
                  <div className="flex items-center gap-3">
                    <Button onClick={() => void guardar()} disabled={guardando}>
                      {guardando ? "Guardando…" : "Guardar"}
                    </Button>
                    {aviso && (
                      <span role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                        {aviso.texto}
                      </span>
                    )}
                  </div>
                )}

                {d.ultimoAviso && (
                  <p className="border-t pt-3 text-xs text-text-3">
                    Último aviso al dueño {hace(d.ultimoAviso.en)}: {d.ultimoAviso.detalle}
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
