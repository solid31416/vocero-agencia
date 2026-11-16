import { agendaEnabled } from "@/server/agenda/flag";
import { atribucionEnabled } from "@/server/attribution/flag";
import { isChannelEnabled } from "@/server/channels/enabled";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { seguimientoEnabled } from "@/server/seguimiento/flag";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";

/**
 * Las banderas que deciden qué hay en Ajustes. Las leen el menú de Ajustes y
 * la entrada `/settings` (que abre en la primera pantalla de ese menú), así
 * que viven en un solo lugar. Se leen en cada petición, nunca al construir.
 */
export function banderasDeAjustes() {
  return {
    agenda: agendaEnabled(),
    atribucion: atribucionEnabled(),
    instagram: isChannelEnabled("instagram"),
    messenger: isChannelEnabled("messenger"),
    tiktok: isChannelEnabled("tiktok"),
    cotizaciones: cotizacionesEnabled(),
    seguimiento: seguimientoEnabled(),
    pedidos: pedidosEnabled(),
    biblioteca: bibliotecaEnabled(),
  };
}
