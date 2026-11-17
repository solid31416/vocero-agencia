"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_METODOS_PAGO, type MetodoPago } from "@/lib/cotizaciones";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Cotizaciones → Condiciones →
 * «Formas de pago»: cada cuenta, tarjeta o forma de abono que el negocio
 * acepta. Todo se escribe a mano y sale en el PDF, en «Cómo pagar».
 */

const nuevoId = () => `mp_${Math.random().toString(36).slice(2, 10)}`;

export const METODO_VACIO: Omit<MetodoPago, "id"> = {
  nombre: "",
  banco: "",
  titular: "",
  clabe: "",
  cuenta: "",
  tarjeta: "",
  notas: "",
};

export function FormasDePago({
  metodos,
  onChange,
  editable,
}: {
  metodos: MetodoPago[];
  onChange: (m: MetodoPago[]) => void;
  editable: boolean;
}) {
  const cambiar = (id: string, parcial: Partial<MetodoPago>) =>
    onChange(metodos.map((m) => (m.id === id ? { ...m, ...parcial } : m)));

  return (
    <section className="space-y-3 border-t pt-4" data-formas-de-pago>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="text-[13px] font-bold">Formas de pago ({metodos.length})</Label>
          <p className="text-xs text-muted-foreground">
            Las cuentas y formas de abono que aceptas. Salen en el PDF, en «Cómo pagar». Llena solo lo que aplique.
          </p>
        </div>
        {editable && metodos.length < MAX_METODOS_PAGO && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...metodos, { id: nuevoId(), ...METODO_VACIO }])}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Agregar forma de pago
          </Button>
        )}
      </div>

      {metodos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin formas de pago todavía. Agrega, por ejemplo, «Transferencia BBVA» con su CLABE y a nombre de quién va,
          «Depósito en OXXO» con el número de tarjeta o «Efectivo en el showroom».
        </p>
      ) : (
        <ul className="space-y-3">
          {metodos.map((m, i) => {
            const id = (campo: string) => `mp-${i}-${campo}`;
            const clabe = m.clabe.replace(/\s+/g, "");
            const clabeMal = clabe.length > 0 && !/^\d{18}$/.test(clabe);
            return (
              <li key={m.id} className="space-y-3 rounded-md border p-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor={id("nombre")}>Nombre</Label>
                    <Input id={id("nombre")} value={m.nombre} maxLength={60} disabled={!editable}
                      placeholder="Transferencia BBVA"
                      onChange={(e) => cambiar(m.id, { nombre: e.target.value })} />
                  </div>
                  {editable && (
                    <Button type="button" variant="ghost" size="sm" aria-label={`Quitar ${m.nombre || "forma de pago"}`}
                      onClick={() => onChange(metodos.filter((x) => x.id !== m.id))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={id("banco")}>Banco</Label>
                    <Input id={id("banco")} value={m.banco} maxLength={60} disabled={!editable} placeholder="BBVA"
                      onChange={(e) => cambiar(m.id, { banco: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("titular")}>A nombre de</Label>
                    <Input id={id("titular")} value={m.titular} maxLength={120} disabled={!editable}
                      placeholder="Nombre o razón social"
                      onChange={(e) => cambiar(m.id, { titular: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("clabe")}>CLABE (18 números)</Label>
                    <Input id={id("clabe")} value={m.clabe} maxLength={24} inputMode="numeric" disabled={!editable}
                      aria-invalid={clabeMal}
                      onChange={(e) => cambiar(m.id, { clabe: e.target.value })} />
                    {clabeMal && (
                      <p className="text-xs text-danger-text">
                        La CLABE lleva 18 números (lleva {clabe.length}).
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("cuenta")}>Número de cuenta</Label>
                    <Input id={id("cuenta")} value={m.cuenta} maxLength={40} disabled={!editable}
                      onChange={(e) => cambiar(m.id, { cuenta: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id("tarjeta")}>Número de tarjeta (para depósitos en tienda)</Label>
                    <Input id={id("tarjeta")} value={m.tarjeta} maxLength={25} inputMode="numeric" disabled={!editable}
                      onChange={(e) => cambiar(m.id, { tarjeta: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={id("notas")}>Instrucciones (opcional)</Label>
                  <Textarea id={id("notas")} rows={2} value={m.notas} maxLength={300} disabled={!editable}
                    placeholder="Manda tu comprobante por este WhatsApp. Pon tu folio como concepto."
                    onChange={(e) => cambiar(m.id, { notas: e.target.value })} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
