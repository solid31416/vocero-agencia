import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { CLAVES_TIPO, type ClienteInput, type TipoCliente } from "@/lib/lab-a-la-medida";
import { renderKb } from "@/server/ai/prompts";
import { armarPromptClientes, depurarClientes, respuestaModeloSchema } from "./prompt";
import { ClienteLabError } from "./store";

/**
 * Módulo de la agencia — escribe los clientes de prueba con la IA del CRM
 * (la llave de Ajustes → IA, como el juez). Lee el perfil y el conocimiento
 * del agente para que hablen de lo que vende ESTE negocio.
 */

const TIMEOUT_MS = 90_000;

export async function generarClientes(input: {
  organizationId: string;
  tipoNegocio: string;
  quienes: string;
  /** Sin esto, los 8 tipos. Con uno: «otro guion» de ese cliente. */
  tipos?: readonly TipoCliente[];
  evitar?: readonly string[];
}): Promise<{ tipoNegocio: string; clientes: ClienteInput[] }> {
  const db = getDb();
  const [perfil] = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, input.organizationId))
    .limit(1);
  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, input.organizationId));

  const tipos = input.tipos ?? CLAVES_TIPO;
  const { system, user } = armarPromptClientes({
    tipos,
    tipoNegocio: input.tipoNegocio,
    quienes: input.quienes,
    nombreAgente: perfil?.name ?? "Asistente",
    instrucciones: [perfil?.instructions, perfil?.escalationRules].filter(Boolean).join("\n\n"),
    conocimiento: kb.length ? renderKb(kb) : "",
    evitar: input.evitar,
  });

  const r = await chatJson(
    respuestaModeloSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { organizationId: input.organizationId, timeoutMs: TIMEOUT_MS }
  );
  if (!r.ok) {
    console.error(`[lab a la medida] no se pudieron generar clientes: ${r.error} — ${r.detail}`);
    if (r.error === "not_configured") {
      throw new ClienteLabError(
        409,
        "ai_not_configured",
        "Configura tu proveedor de IA en Ajustes → IA para generar clientes"
      );
    }
    throw new ClienteLabError(
      502,
      "ia_fallo",
      "La IA no contestó bien. Intenta de nuevo en un momento."
    );
  }

  const limpio = depurarClientes(r.data, tipos);
  // Con todos los tipos, menos de 6 útiles es una respuesta a medias: mejor
  // pedir otra que dejar al Laboratorio cojo sin avisar.
  const minimo = tipos.length === 1 ? 1 : Math.min(6, tipos.length);
  if (limpio.clientes.length < minimo) {
    throw new ClienteLabError(
      502,
      "ia_incompleta",
      "La IA armó clientes incompletos. Intenta de nuevo."
    );
  }
  return limpio;
}
