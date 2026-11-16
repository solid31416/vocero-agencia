import { redirect } from "next/navigation";
import { settingsInicio, settingsSections } from "@/lib/nav";
import { banderasDeAjustes } from "@/server/settings-flags";

export const dynamic = "force-dynamic";

/** «Ajustes» abre en la primera pantalla del menú: con módulos de venta, Cotizaciones (no WhatsApp). */
export default function SettingsPage() {
  redirect(settingsInicio(settingsSections(banderasDeAjustes())));
}
