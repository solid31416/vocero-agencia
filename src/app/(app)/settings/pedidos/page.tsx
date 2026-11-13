import { notFound } from "next/navigation";
import { PedidosAjustesClient } from "@/components/settings/pedidos-client";
import { pedidosEnabled } from "@/server/pedidos/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Pedidos (bandera PEDIDOS). */
export default function PedidosSettingsPage() {
  if (!pedidosEnabled()) notFound();
  return <PedidosAjustesClient />;
}
