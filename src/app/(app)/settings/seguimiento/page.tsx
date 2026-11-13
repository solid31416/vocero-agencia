import { notFound } from "next/navigation";
import { SeguimientoClient } from "@/components/settings/seguimiento-client";
import { seguimientoEnabled } from "@/server/seguimiento/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Seguimiento (bandera SEGUIMIENTO_AUTOMATICO). */
export default function SeguimientoSettingsPage() {
  if (!seguimientoEnabled()) notFound();
  return <SeguimientoClient />;
}
