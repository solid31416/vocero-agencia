import { conceptoDeCotizacion, type CotizacionDto } from "@/lib/cotizaciones";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { crearPedido } from "@/server/pedidos/servicio";
import { listarPedidos, type FilaPedido } from "@/server/pedidos/store";
import { termometroEnabled } from "@/server/termometro/flag";
import { guardarClasificacion, mapa } from "@/server/termometro/store";
import { aDto, cambiarEstado, leerCotizacion } from "./store";
import { montoAlTrato, moverAAceptada } from "./embudo";

/**
 * Módulo de la agencia — el cliente dijo que sí a una cotización.
 *
 * Un solo paso hace lo que antes eran tres a mano: la cotización queda
 * «aceptada», el cliente pasa a caliente en el termómetro y nace su pedido
 * con lo que ya decía la cotización (partidas, total, folio). Si la
 * cotización ya tenía pedido, no se crea otro: se devuelve ese.
 */

export type ResultadoAceptar =
  | {
      ok: true;
      cotizacion: CotizacionDto;
      pedido: FilaPedido | null;
      /** El pedido ya existía (se aceptó dos veces): no se creó otro. */
      yaExistia: boolean;
      /** Por qué no hay pedido, si se pidió y no se pudo. */
      avisoPedido: string | null;
    }
  | { ok: false; status: number; codigo: string; detalle: string };

export async function aceptarCotizacion(input: {
  organizationId: string;
  cotizacionId: string;
  crearPedido: boolean;
  avisar: boolean;
  fechaEstimada: string | null;
  /** Lo que quien acepta corrigió en el formulario del pedido. */
  concepto?: string;
  monto?: number | null;
  userId: string | null;
}): Promise<ResultadoAceptar> {
  const { organizationId, cotizacionId } = input;
  const previa = await leerCotizacion(organizationId, cotizacionId);
  if (!previa) return { ok: false, status: 404, codigo: "no_existe", detalle: "Cotización no encontrada" };
  if (previa.estado === "borrador") {
    return { ok: false, status: 409, codigo: "borrador", detalle: "Primero manda la cotización al cliente" };
  }
  if (previa.estado === "rechazada") {
    return {
      ok: false,
      status: 409,
      codigo: "rechazada",
      detalle: "Esa cotización está marcada como rechazada; regrésala a «Enviada» si el cliente cambió de opinión",
    };
  }

  const fila = (await cambiarEstado(organizationId, cotizacionId, "aceptada")) ?? previa;
  const cotizacion = aDto(fila);

  // El embudo: el trato vale lo que la cotización aceptada.
  await montoAlTrato({
    organizationId,
    contactId: fila.contactId,
    conversationId: fila.conversationId,
    total: input.monto ?? cotizacion.totales.total,
    moneda: cotizacion.moneda,
    soloSiVacio: false,
  });
  // Y pasa a «Cotización aceptada»: aceptó y falta el anticipo.
  await moverAAceptada({
    organizationId,
    contactId: fila.contactId,
    conversationId: fila.conversationId,
    actorUserId: input.userId,
  });

  // El termómetro: quien acepta una cotización está caliente. Se respetan sus etiquetas.
  if (termometroEnabled() && fila.conversationId) {
    try {
      const actual = (await mapa(organizationId))[fila.conversationId];
      await guardarClasificacion(
        organizationId,
        fila.conversationId,
        {
          temperatura: "caliente",
          etiquetas: actual?.etiquetas ?? [],
          razon: `Aceptó la cotización ${cotizacion.folio}`,
        },
        { manual: true }
      );
    } catch (err) {
      console.warn("[cotizaciones] no se pudo poner caliente al cliente:", err);
    }
  }

  if (!input.crearPedido || !pedidosEnabled()) {
    return { ok: true, cotizacion, pedido: null, yaExistia: false, avisoPedido: null };
  }
  if (!fila.conversationId) {
    return {
      ok: true,
      cotizacion,
      pedido: null,
      yaExistia: false,
      avisoPedido: "La cotización ya no tiene conversación: crea el pedido a mano",
    };
  }

  const previos = await listarPedidos(organizationId, { conversationId: fila.conversationId });
  const existente = previos.find((p) => p.cotizacionId === cotizacionId);
  if (existente) return { ok: true, cotizacion, pedido: existente, yaExistia: true, avisoPedido: null };

  const concepto =
    input.concepto?.trim() || conceptoDeCotizacion(cotizacion.partidas) || `Cotización ${cotizacion.folio}`;
  const r = await crearPedido(
    organizationId,
    {
      conversationId: fila.conversationId,
      concepto,
      monto: input.monto === undefined ? cotizacion.totales.total : input.monto,
      fechaEstimada: input.fechaEstimada,
      notas: `Desde la cotización ${cotizacion.folio}`,
      cotizacionId,
      avisar: input.avisar,
    },
    input.userId
  );
  if (!r.ok) return { ok: true, cotizacion, pedido: null, yaExistia: false, avisoPedido: r.detalle };
  return { ok: true, cotizacion, pedido: r.valor, yaExistia: false, avisoPedido: null };
}
