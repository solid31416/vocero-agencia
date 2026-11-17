import { z } from "zod";
import { calcularTotales, type Partida, type Producto, type Totales } from "./cotizaciones";
import type { ConfigVendedor } from "./vendedor-config";

/**
 * Módulo de la agencia — «Vendedor»: el agente cotiza con los precios del
 * catálogo (Ajustes → Ventas → Vendedor).
 *
 * Regla de fondo: el agente NUNCA escribe precios. Elige qué productos y
 * cuántos; el CRM pone el precio de la lista y hace las cuentas. Así no
 * puede cobrar de menos por error ni porque el cliente lo convenza. Todo lo
 * que rebasa un límite del dueño se le pasa a una persona.
 */

export {
  LEYENDA_POR_DEFECTO,
  VENDEDOR_POR_DEFECTO,
  vendedorSchema,
  type ConfigVendedor,
} from "./vendedor-config";
/** Lo que pide el agente: productos del catálogo y cantidades. Nada de precios. */
export const pedidoDelAgenteSchema = z.object({
  conversationId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        productoId: z.string().trim().min(1).max(40),
        cantidad: z.coerce.number().int("La cantidad va en piezas enteras").gt(0).max(10_000),
      })
    )
    .min(1, "Pide al menos un producto")
    .max(20),
  /** A nombre de quién (persona o empresa). Vacío = el nombre del contacto. */
  cliente: z.string().trim().max(120).default(""),
  descuentoPct: z.coerce.number().min(0).max(100).default(0),
  /** A dónde va (para el flete del tabulador). Sin destino, el flete no va. */
  destino: z
    .object({
      estado: z.string().trim().max(40),
      ciudad: z.string().trim().max(60).default(""),
    })
    .nullable()
    .default(null),
});
export type PedidoDelAgente = z.infer<typeof pedidoDelAgenteSchema>;

export type RevisionDelAgente =
  | { ok: true; partidas: Partida[]; descuentoPct: number; totales: Totales }
  | {
      ok: false;
      codigo: string;
      detalle: string;
      /** true: no es un error del agente; lo tiene que ver una persona. */
      paraPersona: boolean;
    };

/** Las piezas de producto (sin extras) que pidió el agente: para buscar el flete. */
export function piezasDelPedido(pedido: Pick<PedidoDelAgente, "items">, productos: readonly Producto[]): number {
  let n = 0;
  for (const it of pedido.items) {
    const p = productos.find((x) => x.id === it.productoId);
    if (p && !p.extra) n += it.cantidad;
  }
  return n;
}

/**
 * Pura: revisa lo que pidió el agente contra el catálogo y los límites del
 * dueño. Devuelve las partidas con los precios de la lista, o por qué no.
 */
export function revisarPedidoDelAgente(
  pedido: Pick<PedidoDelAgente, "items" | "descuentoPct">,
  productos: readonly Producto[],
  vendedor: ConfigVendedor,
  opciones: { ivaPct: number; preciosConIva: boolean; anticipoPct: number },
  /** El flete del tabulador (Fletes), ya calculado por el CRM. */
  flete: Partida | null = null
): RevisionDelAgente {
  if (!vendedor.activo) {
    return { ok: false, codigo: "vendedor_apagado", detalle: "El agente no tiene permiso de cotizar", paraPersona: true };
  }
  // Un producto pedido dos veces se suma.
  const cantidades = new Map<string, number>();
  for (const it of pedido.items) cantidades.set(it.productoId, (cantidades.get(it.productoId) ?? 0) + it.cantidad);

  const partidas: Partida[] = [];
  let piezas = 0;
  for (const [id, cantidad] of cantidades) {
    const p = productos.find((x) => x.id === id);
    if (!p) {
      return {
        ok: false,
        codigo: "producto_desconocido",
        detalle: `«${id}» no está en el catálogo: usa el id exacto de la lista`,
        paraPersona: false,
      };
    }
    // Con el flete del tabulador, un «flete» genérico del catálogo saldría doble.
    if (flete && p.extra && /flete/i.test(p.nombre)) continue;
    if (p.extra && !vendedor.extras.activo) {
      return {
        ok: false,
        codigo: "extras_apagados",
        detalle: `«${p.nombre}» es un extra y no tienes permiso de cotizarlo: quítalo y dile al cliente que ese costo se lo confirma un asesor`,
        paraPersona: false,
      };
    }
    if (!(p.precio > 0)) {
      return {
        ok: false,
        codigo: "sin_precio",
        detalle: `«${p.nombre}» no tiene precio en el catálogo`,
        paraPersona: true,
      };
    }
    if (!p.extra) piezas += cantidad;
    partidas.push({
      productoId: p.id,
      concepto: p.nombre,
      descripcion: p.descripcion,
      cantidad,
      unidad: p.unidad,
      precio: p.precio,
    });
  }

  if (vendedor.cantidadMax.activo && piezas > vendedor.cantidadMax.piezas) {
    return {
      ok: false,
      codigo: "cantidad_maxima",
      detalle: `Son ${piezas} piezas; más de ${vendedor.cantidadMax.piezas} las cotiza una persona`,
      paraPersona: true,
    };
  }

  const descuentoPct = pedido.descuentoPct;
  if (descuentoPct > 0) {
    if (!vendedor.descuento.activo) {
      return {
        ok: false,
        codigo: "descuento_no_permitido",
        detalle: "No tienes permiso de dar descuentos: cotiza a precio de lista",
        paraPersona: false,
      };
    }
    if (descuentoPct > vendedor.descuento.maxPct) {
      return {
        ok: false,
        codigo: "descuento_alto",
        detalle: `El descuento máximo que puedes dar es ${vendedor.descuento.maxPct}%`,
        paraPersona: false,
      };
    }
  }

  if (flete) partidas.push(flete);
  const totales = calcularTotales(partidas, { descuentoPct, ...opciones });
  if (vendedor.tope.activo && totales.total > vendedor.tope.monto) {
    return {
      ok: false,
      codigo: "tope",
      detalle: "El total rebasa el tope que puede cotizar el agente: la hace una persona",
      paraPersona: true,
    };
  }
  return { ok: true, partidas, descuentoPct, totales };
}
