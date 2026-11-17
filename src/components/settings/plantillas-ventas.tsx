"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Send, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DEFAULT_TEMPLATE_LANGUAGE } from "@/lib/template-languages";
import type { PlantillaVentas } from "@/lib/plantillas-ventas";
import type { TemplateDto } from "@/lib/types";

/**
 * Módulo de la agencia (Treviño AI) — Plantillas → «Plantillas para tus
 * ventas»: cuáles necesitan los avisos automáticos, cuáles ya están, y un
 * botón que manda a revisión de Meta las que faltan (con confirmación: cada
 * una llega a Meta en cuanto se crea).
 */
export function PlantillasDeVentas({
  lista,
  templates,
  onCreadas,
}: {
  lista: readonly PlantillaVentas[];
  templates: TemplateDto[] | null;
  onCreadas: () => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  if (lista.length === 0) return null;
  const deMeta = (p: PlantillaVentas) => templates?.find((t) => t.name === p.name) ?? null;
  const faltan = lista.filter((p) => !deMeta(p));

  async function crear() {
    setOcupado(true);
    setAviso(null);
    let creadas = 0;
    const errores: string[] = [];
    for (const p of faltan) {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: p.name,
          language: DEFAULT_TEMPLATE_LANGUAGE,
          category: p.category,
          body: p.body,
          examples: p.examples,
        }),
      }).catch(() => null);
      if (res?.ok) creadas += 1;
      else {
        const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
        errores.push(`${p.titulo}: ${d?.error?.message ?? "no se pudo mandar"}`);
      }
    }
    setOcupado(false);
    setConfirmar(false);
    setAviso(
      errores.length === 0
        ? { ok: true, texto: `Listo: ${creadas} en revisión de Meta. Tarda de unos minutos a 24 h.` }
        : { ok: false, texto: [`${creadas} en revisión.`, ...errores].join(" · ") }
    );
    onCreadas();
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="tpl-ventas-title" data-plantillas-ventas>
      <div>
        <h3 id="tpl-ventas-title" className="text-base font-semibold">
          Plantillas para tus ventas
        </h3>
        <p className="text-sm text-muted-foreground">
          Sin ellas, los avisos automáticos (seguimiento, saldo, pedido, citas, reporte) solo salen si el cliente
          escribió en las últimas 24 h.
        </p>
      </div>

      <ul className="divide-y text-sm">
        {lista.map((p) => {
          const t = deMeta(p);
          return (
            <li key={p.name} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.titulo}</p>
                <p className="text-xs text-muted-foreground">{p.paraQue}</p>
                {t?.status === "approved" && (
                  <Link href={p.ajustes.href} className="text-xs font-medium text-brand-text hover:underline">
                    Elígela en Ajustes → {p.ajustes.label}
                  </Link>
                )}
                {t?.status === "rejected" && t.rejectionReason && (
                  <p className="text-xs text-danger-text">Meta: {t.rejectionReason}</p>
                )}
              </div>
              <Estado status={t?.status ?? null} />
            </li>
          );
        })}
      </ul>

      {faltan.length > 0 && !confirmar && (
        <Button size="sm" onClick={() => setConfirmar(true)} disabled={ocupado}>
          <Send className="h-4 w-4" aria-hidden />
          Mandar a revisión las que faltan ({faltan.length})
        </Button>
      )}
      {confirmar && (
        <div className="space-y-2 rounded-md bg-subtle p-3 text-sm" role="alertdialog" aria-label="Confirmar envío a Meta">
          <p>
            Se mandan <strong>{faltan.length}</strong> plantillas a revisión de Meta, en español (México). Tarda de
            unos minutos a 24 h y no cuesta mandarlas a revisión.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void crear()} disabled={ocupado}>
              {ocupado ? "Mandando…" : "Sí, mandarlas"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmar(false)} disabled={ocupado}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {aviso && (
        <p role="status" className={cn("text-sm", aviso.ok ? "text-success-text" : "text-danger-text")}>
          {aviso.texto}
        </p>
      )}
    </section>
  );
}

function Estado({ status }: { status: TemplateDto["status"] | null }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Aprobada
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text">
        <XCircle className="h-3.5 w-3.5" aria-hidden /> Rechazada
      </span>
    );
  }
  if (status) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-text">
        <Clock className="h-3.5 w-3.5" aria-hidden /> En revisión
      </span>
    );
  }
  return <span className="text-xs font-medium text-text-3">Falta</span>;
}
