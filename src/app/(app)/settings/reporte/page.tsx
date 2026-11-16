import { notFound } from "next/navigation";
import { ReporteSemanalClient } from "@/components/settings/reporte-semanal-client";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Reporte semanal (con la bandera COTIZACIONES). */
export default function ReporteSemanalPage() {
  if (!cotizacionesEnabled()) notFound();
  return <ReporteSemanalClient />;
}
