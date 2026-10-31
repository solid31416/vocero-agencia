import { AiClient } from "@/components/settings/ai-client";
import { ResumenTraspasoCard } from "@/components/settings/resumen-traspaso-card";
import { resumenEnabled } from "@/server/resumen-traspaso/flag";

export const dynamic = "force-dynamic";

export default function AiSettingsPage() {
  return (
    <div className="space-y-4">
      <AiClient />
      {/* Módulo de la agencia: resumen para quien atiende (RESUMEN_TRASPASO). */}
      {resumenEnabled() && <ResumenTraspasoCard />}
    </div>
  );
}
