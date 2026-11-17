import { TemplatesClient } from "@/components/settings/templates-client";
import { plantillasVentasPara } from "@/lib/plantillas-ventas";
import { agendaEnabled } from "@/server/agenda/flag";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { pedidosEnabled } from "@/server/pedidos/flag";

export const dynamic = "force-dynamic";

export default function TemplatesSettingsPage() {
  // Módulo de la agencia: las plantillas que piden los avisos de venta encendidos.
  const ventas = plantillasVentasPara({
    cotizaciones: cotizacionesEnabled(),
    pedidos: pedidosEnabled(),
    agenda: agendaEnabled(),
  });
  return <TemplatesClient ventas={ventas} />;
}
