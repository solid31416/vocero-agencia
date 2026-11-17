import { notFound } from "next/navigation";
import { VendedorClient } from "@/components/settings/vendedor-client";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Ventas → Vendedor (bandera COTIZACIONES). */
export default function VendedorSettingsPage() {
  if (!cotizacionesEnabled()) notFound();
  return <VendedorClient />;
}
