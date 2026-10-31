import { notFound } from "next/navigation";
import { contadorEnabled } from "@/server/contador-mensajes/flag";
import { ContadorMensajes } from "@/components/results/contador-mensajes";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Resultados → Mensajes de WhatsApp (bandera CONTADOR_MENSAJES). */
export default function MensajesPage() {
  if (!contadorEnabled()) notFound();
  return <ContadorMensajes />;
}
