import { CuentaClient } from "@/components/settings/cuenta-client";

export const dynamic = "force-dynamic";

/** Módulo de la agencia — Ajustes → Tu cuenta → Contraseña. La ve todo el equipo. */
export default function CuentaPage() {
  return <CuentaClient />;
}
