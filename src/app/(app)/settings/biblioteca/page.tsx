import { notFound } from "next/navigation";
import { BibliotecaClient } from "@/components/settings/biblioteca-client";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";

export const dynamic = "force-dynamic";

/** Módulo de la agencia: Ajustes → Biblioteca (bandera BIBLIOTECA). */
export default function BibliotecaSettingsPage() {
  if (!bibliotecaEnabled()) notFound();
  return <BibliotecaClient />;
}
