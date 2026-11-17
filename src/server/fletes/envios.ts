import type { Envio, EnvioInput } from "@/lib/fletes";
import { actualizarPedido, hoyIso, leerPedido, listarPedidos, type FilaPedido } from "@/server/pedidos/store";
import { leerFletes } from "./store";

/**
 * Módulo de la agencia — Fletes: el seguimiento del envío de cada pedido
 * (transportista, guía, fechas, costo contra lo cobrado). Es interno: al
 * cliente se le avisa con las etapas del pedido, como siempre.
 */

type Resultado<T> = { ok: true; valor: T } | { ok: false; status: number; codigo: string; detalle: string };

export async function guardarEnvio(
  organizationId: string,
  pedidoId: string,
  input: EnvioInput | null
): Promise<Resultado<FilaPedido>> {
  const previo = await leerPedido(organizationId, pedidoId);
  if (!previo) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  let envio: Envio | null = null;
  if (input) {
    const fletes = await leerFletes(organizationId);
    const tr = input.transportistaId ? fletes.transportistas.find((t) => t.id === input.transportistaId) : null;
    if (input.transportistaId && !tr && input.transportistaId !== previo.envio?.transportistaId) {
      return { ok: false, status: 422, codigo: "transportista", detalle: "Esa transportista ya no está en Fletes" };
    }
    envio = {
      ...input,
      // Si ya se marcó entregado sin fecha, es hoy.
      entregadoEl: input.estado === "entregado" ? (input.entregadoEl ?? hoyIso()) : input.entregadoEl,
      transportistaNombre: tr?.nombre ?? (input.transportistaId ? (previo.envio?.transportistaNombre ?? "") : ""),
      actualizadoEn: new Date().toISOString(),
    };
  }
  const f = await actualizarPedido(organizationId, pedidoId, { envio });
  if (!f) return { ok: false, status: 404, codigo: "not_found", detalle: "Pedido no encontrado" };
  return { ok: true, valor: f };
}

/** Los pedidos con envío, para el seguimiento en Ventas → Fletes. */
export async function pedidosConEnvio(organizationId: string): Promise<FilaPedido[]> {
  const todos = await listarPedidos(organizationId, { limite: 300 });
  return todos.filter((p) => p.envio);
}
