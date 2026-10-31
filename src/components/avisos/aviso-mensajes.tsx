import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";
import { canConfigure } from "@/lib/auth/roles";
import { GRATIS_SERVICIO } from "@/lib/contador-mensajes";
import { contadorEnabled } from "@/server/contador-mensajes/flag";
import { calcularMesCacheado } from "@/server/contador-mensajes/resumen";

/**
 * Módulo de la agencia — la franja del contador de mensajes, en TODA la app.
 *
 * - «Meta no está entregando» (problema de pago): la ve todo el equipo, porque
 *   cualquiera puede estar contestando al vacío.
 * - «Cerca del límite de gratis»: solo quien administra (es una decisión de dinero).
 *
 * «Ya se cobran» no lleva franja: es lo normal en un negocio con movimiento y
 * con tarjeta; se ve en Resultados → Mensajes y el dueño recibe un aviso.
 * Sin descartar, como la franja del agente: se va sola cuando se arregla.
 */
export async function AvisoMensajesBanner({
  organizationId,
  role,
}: {
  organizationId: string;
  role: string | null | undefined;
}) {
  if (!contadorEnabled()) return null;
  let estado: string;
  let usadas = 0;
  try {
    const { resumen } = await calcularMesCacheado(organizationId);
    estado = resumen.estado;
    usadas = resumen.servicio.usadas;
  } catch (err) {
    console.error("[contador] franja:", err);
    return null;
  }
  const grave = estado === "no_entrega";
  if (!grave && !(estado === "cerca" && canConfigure(role))) return null;
  return (
    <div
      role="status"
      data-aviso-mensajes
      className={
        grave
          ? "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-danger-soft bg-danger-tint px-4 py-2.5 text-[13px] text-danger-text"
          : "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning-soft bg-warning-tint px-4 py-2.5 text-[13px] text-warning-text"
      }
    >
      <MessageSquareWarning className="h-4 w-4 shrink-0" strokeWidth={1.7} />
      <span className="min-w-0 flex-1">
        {grave
          ? "Meta no está entregando mensajes de tu WhatsApp por un problema de pago: tus clientes no reciben las respuestas."
          : `Llevas ${usadas.toLocaleString("es-MX")} de ${GRATIS_SERVICIO.toLocaleString("es-MX")} respuestas gratis de WhatsApp este mes. Después se cobran, y sin tarjeta en Meta dejan de entregarse.`}
      </span>
      <Link href="/results/mensajes" className="shrink-0 font-medium underline underline-offset-2">
        Ver mensajes →
      </Link>
    </div>
  );
}
