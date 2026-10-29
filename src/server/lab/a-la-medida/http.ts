import { apiError } from "@/lib/api";
import { labALaMedidaEnabled } from "./flag";
import { ClienteLabError } from "./store";

/**
 * Módulo de la agencia — lo común a las rutas del Laboratorio a la medida:
 * con la bandera apagada no existen (404 vacío), y los errores del módulo
 * salen con el sobre de error del CRM.
 */
export async function conModulo(fn: () => Promise<Response>): Promise<Response> {
  if (!labALaMedidaEnabled()) return new Response(null, { status: 404 });
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ClienteLabError) return apiError(err.status, err.code, err.message);
    throw err;
  }
}
