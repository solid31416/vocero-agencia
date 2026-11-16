"use client";

import Link from "next/link";
import { formatoDinero } from "@/lib/cotizaciones";
import type { PorModeloDto } from "@/lib/por-modelo";
import { Section } from "./section";

/**
 * Módulo de la agencia (Treviño AI) — Resultados por modelo: qué producto
 * jala más clientes, cuál se cotiza y cuál se cierra.
 */
export function ModelosSection({
  data,
  loading,
  error,
}: {
  data: PorModeloDto | null;
  loading: boolean;
  error: string | null;
}) {
  const max = data ? Math.max(1, ...data.filas.map((f) => f.interesados)) : 1;
  const sinMovimiento = data ? data.filas.every((f) => f.interesados === 0 && f.cotizadas === 0) : false;
  return (
    <Section
      id="por-modelo"
      title="Por modelo"
      hint="Por cada producto: cuántos clientes preguntaron, cuántas cotizaciones salieron y cuántas se cerraron."
      loading={loading}
      error={error}
      hasData={!!data}
      empty={!!data && (data.sinLista || sinMovimiento)}
      emptyText={
        data?.sinLista
          ? "Carga tu lista de productos en Ajustes → Cotizaciones para ver esto."
          : "Nadie preguntó por tus productos en este periodo."
      }
    >
      {data && (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[34rem] text-sm" data-por-modelo>
            <thead>
              <tr className="border-b text-left text-xs text-text-3">
                <th className="py-2 pr-3 font-medium">Modelo</th>
                <th className="py-2 pr-3 font-medium">Preguntaron</th>
                <th className="py-2 pr-3 text-right font-medium" title="A cuántos se les mandaron sus fotos o videos">
                  Con fotos
                </th>
                <th className="py-2 pr-3 text-right font-medium">Cotizaciones</th>
                <th className="py-2 pr-3 text-right font-medium">Cerradas</th>
                <th className="py-2 text-right font-medium">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((f) => (
                <tr key={f.productoId} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{f.nombre}</td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-right tabular-nums">{f.interesados}</span>
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-border" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${(f.interesados / max) * 100}%` }}
                        />
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{f.conFotos}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{f.cotizadas}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {f.aceptadas}
                    {f.cierre !== null && <span className="ml-1 text-xs text-text-3">({f.cierre}%)</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {f.vendido > 0 ? formatoDinero(f.vendido, data.moneda) : <span className="text-text-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-text-3">
            «Preguntaron» cuenta a quien lo nombró en un mensaje, recibió sus fotos o una cotización con él. Vendido es
            sin IVA, de las cotizaciones{" "}
            <Link href="/settings/cotizaciones" className="underline underline-offset-2">
              marcadas aceptadas
            </Link>
            .
          </p>
        </div>
      )}
    </Section>
  );
}
