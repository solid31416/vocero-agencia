import {
  calcularEspera,
  decidirAvisos,
  dentroDeHorario,
  rellenar,
  siguienteApertura,
  textoApertura,
  textoParaDueno,
  type EsperaDto,
} from "@/lib/espera-humano";
import { getEnv } from "@/lib/env";
import { businessTimezone } from "@/server/analytics/period";
import { avisarAlDueno } from "@/server/contador-mensajes/worker";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { esperaEnabled } from "./flag";
import {
  anotarResultado,
  apartarAviso,
  avisosRecientes,
  conversacionesPausadas,
  leerConfig,
  llaveAviso,
  organizacionesActivas,
} from "./store";

/**
 * Módulo de la agencia — «Nadie ha contestado».
 *
 * Un revisor cada minuto mira las conversaciones con la IA pausada:
 * - Si el agente pasó al cliente con una persona y nadie ha escrito en X
 *   minutos, le manda al cliente un aviso (uno por traspaso). Fuera de
 *   horario dice cuándo le contestan. Va como mensaje automático (no cuenta
 *   como respuesta de una persona para los otros módulos).
 * - Si alguien lleva Y minutos esperando y es horario de atención, le avisa
 *   al dueño por WhatsApp (uno por espera). De noche no: a la hora de abrir.
 * Nunca lanza.
 */

const INTERVALO_MS = 60 * 1000;

type Estado = { timer: ReturnType<typeof setInterval> | null; corriendo: boolean };
const g = globalThis as unknown as { __esperaHumano?: Estado };
function estado(): Estado {
  g.__esperaHumano ??= { timer: null, corriendo: false };
  return g.__esperaHumano;
}

export function iniciarEsperaHumano(): void {
  if (!esperaEnabled()) return;
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tandaEspera(), INTERVALO_MS);
  e.timer.unref?.();
  console.log("[espera] revisor encendido (cada minuto)");
}

/** Las esperas de una organización tal como las ve la bandeja. */
export async function mapaEspera(organizationId: string): Promise<Record<string, EsperaDto>> {
  const [filas, avisos] = await Promise.all([conversacionesPausadas(organizationId), avisosRecientes(organizationId)]);
  const r: Record<string, EsperaDto> = {};
  for (const f of filas) {
    const espera = calcularEspera(f);
    if (!espera) continue;
    const cliente = avisos.get(llaveAviso(f.conversationId, "cliente", espera.desde));
    const dueno = avisos.get(llaveAviso(f.conversationId, "dueno", espera.desde));
    r[f.conversationId] = {
      desde: espera.desde.toISOString(),
      caso: espera.caso,
      avisoClienteEn: cliente?.enviadoEn.toISOString() ?? null,
      avisoDuenoEn: dueno?.enviadoEn.toISOString() ?? null,
    };
  }
  return r;
}

export type ResultadoTanda = { clientes: number; duenos: number };

export async function tandaEspera(opciones: { ahora?: Date } = {}): Promise<ResultadoTanda> {
  const r: ResultadoTanda = { clientes: 0, duenos: 0 };
  const e = estado();
  if (e.corriendo) return r;
  e.corriendo = true;
  try {
    const ahora = opciones.ahora ?? new Date();
    for (const org of await organizacionesActivas()) {
      try {
        await revisarOrganizacion(org, ahora, r);
      } catch (err) {
        console.error("[espera] falló la revisión de una organización", err);
      }
    }
  } catch (err) {
    console.error("[espera] falló la tanda", err);
  } finally {
    e.corriendo = false;
  }
  return r;
}

async function revisarOrganizacion(org: string, ahora: Date, r: ResultadoTanda): Promise<void> {
  const config = await leerConfig(org);
  if (!config.activo) return;
  const filas = await conversacionesPausadas(org);
  if (filas.length === 0) return;
  const zona = await businessTimezone(org);
  const dentro = dentroDeHorario(config.horario, ahora, zona);
  const avisos = await avisosRecientes(org);

  for (const f of filas) {
    const espera = calcularEspera(f);
    if (!espera) continue;
    const toca = decidirAvisos({
      espera,
      ahora,
      config,
      dentroDeHorario: dentro,
      yaCliente: avisos.has(llaveAviso(f.conversationId, "cliente", espera.desde)),
      yaDueno: avisos.has(llaveAviso(f.conversationId, "dueno", espera.desde)),
    });

    if (toca.cliente) {
      const id = await apartarAviso(org, f.conversationId, "cliente", espera.desde);
      if (id) {
        const texto = dentro
          ? config.textoCliente
          : rellenar(config.textoFuera, { apertura: textoApertura(siguienteApertura(config.horario, ahora, zona)) });
        let resultado = "Enviado al cliente";
        try {
          // Mensaje automático: va como de la IA para que no cuente como respuesta de una persona.
          await sendText({ organizationId: org, conversationId: f.conversationId, text: texto, aiGenerated: true });
          r.clientes++;
        } catch (err) {
          resultado = `No se pudo mandar: ${err instanceof Error ? err.message : String(err)}`;
        }
        await anotarResultado(org, id, resultado);
        publish(org, { type: "conversation.updated", data: { conversation: { id: f.conversationId } } });
      }
    }

    if (toca.dueno && config.telefonoDueno) {
      const id = await apartarAviso(org, f.conversationId, "dueno", espera.desde);
      if (id) {
        const ultimo = f.ultimoTipo === "text" ? f.ultimoTexto.trim() : `[${f.ultimoTipo}]`;
        const texto = textoParaDueno({
          nombre: f.nombre,
          esperaMs: ahora.getTime() - espera.desde.getTime(),
          ultimo,
          enlace: `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/inbox?conversation=${f.conversationId}`,
        });
        let resultado: string;
        try {
          resultado = await avisarAlDueno(org, { telefonoDueno: config.telefonoDueno, plantillaId: null }, texto, "⏱️ ");
          r.duenos++;
        } catch (err) {
          resultado = `No se pudo avisar: ${err instanceof Error ? err.message : String(err)}`;
        }
        await anotarResultado(org, id, resultado);
        publish(org, { type: "conversation.updated", data: { conversation: { id: f.conversationId } } });
      }
    }
  }
}
