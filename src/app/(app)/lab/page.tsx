import { LabClient } from "@/components/lab/lab-client";
import { labALaMedidaEnabled } from "@/server/lab/a-la-medida/flag";

export const dynamic = "force-dynamic";

export default function LabPage() {
  // Módulo de la agencia: clientes de prueba a la medida (LAB_A_LA_MEDIDA).
  return <LabClient aLaMedida={labALaMedidaEnabled()} />;
}
