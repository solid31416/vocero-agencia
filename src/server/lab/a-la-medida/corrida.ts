import {
  personaParaElJuez,
  telefonoSintetico,
  type ClienteDto,
} from "@/lib/lab-a-la-medida";
import type { Persona } from "@/server/lab/personas";

/**
 * Módulo de la agencia — cómo entra un cliente propio a una corrida. Puro.
 *
 * Un cliente propio se vuelve una `Persona` como las de fábrica: su clave es
 * su id (`lpm_…`), su teléfono es sintético, y su `description` es lo que el
 * juez lee (el tipo manda: «pide_humano» se juzga por si escaló).
 */

/** Los del rol del agente (como las de fábrica). Los escritos a mano entran siempre. */
export function clientesDelRol(
  clientes: readonly ClienteDto[],
  clavesDelRol: readonly string[]
): ClienteDto[] {
  return clientes.filter((c) => c.propio || clavesDelRol.includes(c.tipo));
}

export function personaDeCliente(c: ClienteDto): Persona {
  return {
    key: c.id,
    label: c.nombre,
    description: personaParaElJuez(c.tipo, c.nombre),
    phone: telefonoSintetico(c.id),
    contactName: `[Prueba] ${c.nombre}`.slice(0, 80),
    script: c.guion,
  };
}
