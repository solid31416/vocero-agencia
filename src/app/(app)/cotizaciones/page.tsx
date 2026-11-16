import { notFound } from "next/navigation";
import { CotizacionesLista } from "@/components/cotizaciones/cotizaciones-lista";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: la pantalla «Cotizaciones» del menú (bandera COTIZACIONES). */
export default function CotizacionesPage() {
  if (!cotizacionesEnabled()) notFound();
  return <CotizacionesLista />;
}
