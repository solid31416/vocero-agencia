import { notFound } from "next/navigation";
import { AgendaClient } from "@/components/settings/agenda-client";
import { agendaEnabled } from "@/server/agenda/flag";
import { RecordatoriosCard } from "@/components/settings/recordatorios-card";
import { recordatoriosEnabled } from "@/server/recordatorios/flag";

export const dynamic = "force-dynamic";

export default function AgendaSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!agendaEnabled()) notFound();
  return (
    <div className="space-y-4">
      <AgendaClient />
      {/* Módulo de la agencia: recordatorios de cita (RECORDATORIOS_CITAS). */}
      {recordatoriosEnabled() && <RecordatoriosCard />}
    </div>
  );
}
