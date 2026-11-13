import { notFound } from "next/navigation";
import { CotizacionesClient } from "@/components/settings/cotizaciones-client";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Cotizaciones (bandera COTIZACIONES). */
export default function CotizacionesSettingsPage() {
  if (!cotizacionesEnabled()) notFound();
  return <CotizacionesClient />;
}
