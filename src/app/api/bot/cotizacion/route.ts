import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { pedidoDelAgenteSchema } from "@/lib/vendedor";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { cotizarDelAgente } from "@/server/cotizaciones/vendedor";

export const dynamic = "force-dynamic";

/**
 * Módulo de la agencia — el agente como vendedor arma una cotización.
 *
 * El cerebro manda SOLO productos del catálogo (`productoId`) y cantidades;
 * el precio lo pone el CRM. Según Ajustes → Ventas → Vendedor, la cotización
 * queda para que una persona la mande (`estado: "por_aprobar"`) o sale sola
 * (`"enviada"`).
 *
 * 404 vacío sin la bandera `COTIZACIONES`. Errores con `paraPersona`:
 * - 409 + `paraPersona: true` (vendedor_apagado, tope, cantidad_maxima,
 *   sin_precio, limite, window_closed…): el agente avisa que un asesor sigue
 *   y escala con handoff.
 * - 422/409 + `paraPersona: false` (producto_desconocido, extras_apagados,
 *   descuento_no_permitido, descuento_alto, persona_armando): el agente
 *   corrige su pedido o le explica al cliente.
 */
export async function POST(req: Request) {
  if (!cotizacionesEnabled()) return new Response(null, { status: 404 });
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) return apiError(409, "no_org", "La instancia aún no tiene organización");

  const body = await parseBody(req, pedidoDelAgenteSchema);
  if (!body.ok) return body.response;

  // Mismo gate que los mensajes: el agente jamás actúa en una plática que tomó una persona.
  const [conv] = await getDb()
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.aiEnabled || conv.handoffAt) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }

  const r = await cotizarDelAgente({ organizationId, pedido: body.data, esPrueba: conv.isTest });
  if (!r.ok) {
    return Response.json(
      { error: { code: r.codigo, message: r.detalle }, paraPersona: r.paraPersona },
      { status: r.status }
    );
  }
  return Response.json({
    estado: r.estado,
    folio: r.folio,
    total: r.total,
    anticipo: r.anticipo,
    resumen: r.resumen,
  });
}
