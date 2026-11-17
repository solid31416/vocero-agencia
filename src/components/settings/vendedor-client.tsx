"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NumeroInput } from "@/components/ui/numero-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatoDinero } from "@/lib/cotizaciones";
import { LEYENDA_POR_DEFECTO, type ConfigVendedor } from "@/lib/vendedor";

/**
 * Módulo de la agencia — Ajustes → Ventas → Vendedor: si el agente vende,
 * cómo manda las cotizaciones y hasta dónde puede llegar solo.
 */

type Datos = {
  vendedor: ConfigVendedor;
  moneda: "MXN" | "USD";
  catalogo: { modelos: number; modelosSinPrecio: string[]; extras: string[] };
  telefonoAviso: string | null;
  puedeEditar: boolean;
};

function Fila({
  titulo,
  ayuda,
  checked,
  onChange,
  disabled,
  children,
}: {
  titulo: string;
  ayuda: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 border-b py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <Switch checked={checked} onCheckedChange={onChange} label={titulo} disabled={disabled} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-xs text-text-3">{ayuda}</p>
        </div>
      </div>
      {checked && children && <div className="pl-12">{children}</div>}
    </div>
  );
}

export function VendedorClient() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [v, setV] = useState<ConfigVendedor | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/settings/vendedor").catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as Datos;
    setDatos(d);
    setV(d.vendedor);
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || !v) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const editable = datos.puedeEditar;
  const cambiar = (p: Partial<ConfigVendedor>) => {
    setV({ ...v, ...p });
    setAviso(null);
  };
  const sinCambios = JSON.stringify(v) === JSON.stringify(datos.vendedor);

  async function guardar() {
    setGuardando(true);
    const res = await fetch("/api/settings/vendedor", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(v),
    }).catch(() => null);
    setGuardando(false);
    const d = (await res?.json().catch(() => null)) as { vendedor?: ConfigVendedor; error?: { message?: string } } | null;
    if (!res?.ok || !d?.vendedor) {
      setAviso({ ok: false, texto: d?.error?.message ?? "No se pudo guardar" });
      return;
    }
    setDatos((x) => (x ? { ...x, vendedor: d.vendedor! } : x));
    setV(d.vendedor);
    setAviso({ ok: true, texto: "Guardado. El agente lo usa desde su siguiente mensaje." });
  }

  const sinCatalogo = datos.catalogo.modelos === 0;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgeDollarSign className="h-5 w-5" /> Vendedor
          </CardTitle>
          <CardDescription>
            El agente cotiza con los precios de tu catálogo (
            <Link href="/settings/cotizaciones" className="text-brand-text hover:underline">
              Ajustes → Cotizaciones
            </Link>
            ). Él solo elige qué modelo y cuántos: el precio y las cuentas los pone el CRM, así que no puede
            cobrar de menos. Antes de cotizar, le confirma al cliente qué le va a cotizar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sinCatalogo && (
            <p className="mb-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning-text">
              Tu catálogo no tiene modelos todavía: agrégalos en Ajustes → Cotizaciones para que el agente pueda
              cotizar.
            </p>
          )}
          {datos.catalogo.modelosSinPrecio.length > 0 && (
            <p className="mb-3 rounded-md bg-warning-tint px-3 py-2 text-sm text-warning-text">
              Sin precio (el agente no los puede cotizar): {datos.catalogo.modelosSinPrecio.join(", ")}.
            </p>
          )}

          <Fila
            titulo="Activar al agente como vendedor"
            ayuda="Apagado: el agente no da precios del catálogo ni arma cotizaciones; las haces tú con «Cotizar»."
            checked={v.activo}
            onChange={(activo) => cambiar({ activo })}
            disabled={!editable}
          />

          <div className={cn(!v.activo && "pointer-events-none opacity-50")} aria-disabled={!v.activo}>
            <Fila
              titulo="Puede decir precios en la plática"
              ayuda="Apagado: no menciona precios; ofrece mandar la cotización."
              checked={v.preciosEnChat}
              onChange={(preciosEnChat) => cambiar({ preciosEnChat })}
              disabled={!editable || !v.activo}
            />

            <div className="space-y-2 border-b py-3">
              <p className="text-sm font-medium">Cuando arma una cotización</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["aprobar", "Te avisa y tú la mandas", "La deja lista; la revisas en «Cotizar» y le das «Enviar»."],
                    ["sola", "La manda sola", "Sale el PDF al cliente sin esperar a nadie, con la leyenda de abajo."],
                  ] as const
                ).map(([valor, titulo, ayuda]) => (
                  <button
                    key={valor}
                    type="button"
                    disabled={!editable || !v.activo}
                    onClick={() => cambiar({ modoEnvio: valor })}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors",
                      v.modoEnvio === valor ? "border-brand bg-brand-tint" : "hover:border-text-3"
                    )}
                    aria-pressed={v.modoEnvio === valor}
                  >
                    <span className="block text-sm font-medium">{titulo}</span>
                    <span className="block text-xs text-text-3">{ayuda}</span>
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  checked={v.avisarWhatsapp}
                  disabled={!editable || !v.activo}
                  onChange={(e) => cambiar({ avisarWhatsapp: e.target.checked })}
                />
                Avisarme también por WhatsApp
                <span className="text-xs text-text-3">
                  {datos.telefonoAviso
                    ? `(al número que termina en ${datos.telefonoAviso})`
                    : "(pon tu número en Ajustes → IA → Resumen para recibirlo)"}
                </span>
              </label>
              <p className="text-xs text-text-3">Siempre queda una nota interna en la conversación.</p>
            </div>

            <Fila
              titulo="Tope de monto"
              ayuda="Si el total pasa de esto, no la arma: le pasa la conversación a una persona."
              checked={v.tope.activo}
              onChange={(activo) => cambiar({ tope: { ...v.tope, activo } })}
              disabled={!editable || !v.activo}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="ven-tope" className="text-sm font-normal">
                  Hasta
                </Label>
                <NumeroInput
                  id="ven-tope"
                  className="w-44"
                  min={1}
                  step="any"
                  value={v.tope.monto}
                  disabled={!editable}
                  onValueChange={(n) => cambiar({ tope: { ...v.tope, monto: Number.isFinite(n) && n > 0 ? n : 1 } })}
                />
                <span className="text-xs text-text-3">{formatoDinero(v.tope.monto, datos.moneda)} con IVA</span>
              </div>
            </Fila>

            <Fila
              titulo="Cantidad máxima"
              ayuda="Más piezas que esto (sin contar fletes ni extras) las cotiza una persona."
              checked={v.cantidadMax.activo}
              onChange={(activo) => cambiar({ cantidadMax: { ...v.cantidadMax, activo } })}
              disabled={!editable || !v.activo}
            >
              <div className="flex items-center gap-2">
                <NumeroInput
                  id="ven-piezas"
                  className="w-24"
                  min={1}
                  step={1}
                  value={v.cantidadMax.piezas}
                  disabled={!editable}
                  onValueChange={(n) =>
                    cambiar({ cantidadMax: { ...v.cantidadMax, piezas: Math.max(1, Math.round(Number.isFinite(n) ? n : 1)) } })
                  }
                />
                <span className="text-sm">piezas por cotización</span>
              </div>
            </Fila>

            <Fila
              titulo="Puede dar descuento"
              ayuda="Apagado: siempre a precio de lista, aunque el cliente lo pida."
              checked={v.descuento.activo}
              onChange={(activo) => cambiar({ descuento: { ...v.descuento, activo } })}
              disabled={!editable || !v.activo}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">Hasta</span>
                <NumeroInput
                  id="ven-descuento"
                  className="w-20"
                  min={0}
                  max={50}
                  step="any"
                  value={v.descuento.maxPct}
                  disabled={!editable}
                  onValueChange={(n) =>
                    cambiar({ descuento: { ...v.descuento, maxPct: Math.min(50, Math.max(0, Number.isFinite(n) ? n : 0)) } })
                  }
                />
                <span className="text-sm">%</span>
              </div>
            </Fila>

            <Fila
              titulo="Puede cotizar fletes y extras"
              ayuda={
                datos.catalogo.extras.length > 0
                  ? `Los extras de tu catálogo: ${datos.catalogo.extras.join(", ")}. Apagado: dice que el flete se lo confirma un asesor.`
                  : "Tu catálogo no tiene extras. Apagado: dice que el flete se lo confirma un asesor."
              }
              checked={v.extras.activo}
              onChange={(activo) => cambiar({ extras: { activo } })}
              disabled={!editable || !v.activo}
            />

            <div className={cn("space-y-2 py-3", v.modoEnvio !== "sola" && "opacity-60")}>
              <p className="text-sm font-medium">Cuando la manda sola</p>
              <Label htmlFor="ven-leyenda" className="text-xs font-normal text-text-3">
                Leyenda en el PDF (vacía = sin leyenda)
              </Label>
              <Textarea
                id="ven-leyenda"
                rows={2}
                maxLength={300}
                value={v.leyenda}
                disabled={!editable || !v.activo}
                placeholder={LEYENDA_POR_DEFECTO}
                onChange={(e) => cambiar({ leyenda: e.target.value })}
              />
              <div className="flex items-center gap-2">
                <span className="text-sm">Vigencia</span>
                <NumeroInput
                  id="ven-vigencia"
                  className="w-20"
                  min={1}
                  max={365}
                  step={1}
                  value={v.vigenciaDias}
                  disabled={!editable || !v.activo}
                  onValueChange={(n) =>
                    cambiar({ vigenciaDias: Math.min(365, Math.max(1, Math.round(Number.isFinite(n) ? n : 7))) })
                  }
                />
                <span className="text-sm">días</span>
              </div>
              <p className="text-xs text-text-3">
                Si se equivocó, en «Cotizar» le das «Corregir»: sale una nueva y la anterior queda como corregida.
              </p>
            </div>
          </div>

          {editable && (
            <div className="flex flex-wrap items-center gap-3 pt-3">
              <Button onClick={() => void guardar()} disabled={guardando || sinCambios}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
              {aviso && (
                <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
                  {aviso.texto}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
