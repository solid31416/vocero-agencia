import { notFound } from "next/navigation";
import { PedidosLista } from "@/components/pedidos/pedidos-lista";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";
import { pedidosEnabled } from "@/server/pedidos/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: la pantalla «Pedidos» (bandera PEDIDOS). */
export default async function PedidosPage() {
  if (!pedidosEnabled()) notFound();
  const session = await getSessionOrNull();
  return <PedidosLista puedeBorrar={canConfigure(session?.role)} />;
}
