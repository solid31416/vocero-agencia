import { notFound } from "next/navigation";
import { FletesClient } from "@/components/settings/fletes-client";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Ventas → Fletes (bandera COTIZACIONES). */
export default function FletesSettingsPage() {
  if (!cotizacionesEnabled()) notFound();
  return <FletesClient />;
}
