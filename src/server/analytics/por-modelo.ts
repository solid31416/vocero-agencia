import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  clavesDeProductos,
  esDelProducto,
  menciona,
  porcentajeCierre,
  type FilaModeloDto,
  type PorModeloDto,
} from "@/lib/por-modelo";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { archivo, asegurarTablas as tablasBiblioteca, envio } from "@/server/biblioteca/store";
import { asegurarTablas as tablasCotizaciones, cotizacion, leerConfig } from "@/server/cotizaciones/store";
import type { ResolvedPeriod } from "./period";

/**
 * Módulo de la agencia — Resultados por modelo: por cada producto de la
 * lista (Ajustes → Cotizaciones), quién preguntó, a quién se le mandaron sus
 * fotos, cuántas cotizaciones salieron, cuántas se cerraron y cuánto se vendió.
 *
 * «Preguntó» = el cliente lo nombró en un mensaje del periodo (por las
 * palabras que lo distinguen de los demás), recibió sus fotos de la
 * Biblioteca o una cotización con él. El Laboratorio no cuenta.
 */

/** Tope de mensajes leídos por periodo: de sobra para un negocio de pocos productos. */
const MAX_MENSAJES = 20_000;

export async function porModeloBlock(organizationId: string, period: ResolvedPeriod): Promise<PorModeloDto> {
  await tablasCotizaciones();
  const config = await leerConfig(organizationId);
  const productos = config.productos;
  if (productos.length === 0) return { filas: [], moneda: config.moneda, sinLista: true };
  const claves = clavesDeProductos(productos);
  const db = getDb();

  // Lo que escribieron los clientes en el periodo.
  const mensajes = await db
    .select({ conversationId: schema.message.conversationId, text: schema.message.text })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.direction, "in"),
        eq(schema.conversation.isTest, false),
        gte(schema.message.createdAt, period.start),
        lt(schema.message.createdAt, period.end)
      )
    )
    .limit(MAX_MENSAJES);

  // Las cotizaciones enviadas en el periodo.
  const cotizaciones = await db
    .select({
      conversationId: cotizacion.conversationId,
      estado: cotizacion.estado,
      partidas: cotizacion.partidas,
    })
    .from(cotizacion)
    .innerJoin(schema.conversation, eq(schema.conversation.id, cotizacion.conversationId))
    .where(
      and(
        eq(cotizacion.organizationId, organizationId),
        inArray(cotizacion.estado, ["enviada", "aceptada", "rechazada", "vencida"]),
        eq(schema.conversation.isTest, false),
        gte(cotizacion.enviadaEn, period.start),
        lt(cotizacion.enviadaEn, period.end)
      )
    );

  // Las fotos y videos de la Biblioteca que salieron en el periodo.
  let envios: { conversationId: string; titulo: string }[] = [];
  if (bibliotecaEnabled()) {
    try {
      await tablasBiblioteca();
      envios = await db
        .select({ conversationId: envio.conversationId, titulo: archivo.titulo })
        .from(envio)
        .innerJoin(archivo, eq(archivo.id, envio.archivoId))
        .innerJoin(schema.conversation, eq(schema.conversation.id, envio.conversationId))
        .where(
          and(
            eq(envio.organizationId, organizationId),
            eq(schema.conversation.isTest, false),
            gte(envio.createdAt, period.start),
            lt(envio.createdAt, period.end)
          )
        );
    } catch (err) {
      console.warn("[resultados] no se pudieron leer los envíos de la Biblioteca:", err);
    }
  }

  const filas: FilaModeloDto[] = productos.map((p) => {
    const suyas = claves.get(p.id) ?? [];
    const interesados = new Set<string>();
    const conFotos = new Set<string>();
    for (const m of mensajes) if (m.text && menciona(m.text, suyas)) interesados.add(m.conversationId);
    for (const e of envios) {
      if (esDelProducto({ concepto: e.titulo }, p, suyas)) {
        conFotos.add(e.conversationId);
        interesados.add(e.conversationId);
      }
    }
    let cotizadas = 0;
    let aceptadas = 0;
    let vendido = 0;
    for (const c of cotizaciones) {
      const partidas = c.partidas.filter((x) => esDelProducto(x, p, suyas));
      if (partidas.length === 0) continue;
      cotizadas += 1;
      if (c.conversationId) interesados.add(c.conversationId);
      if (c.estado === "aceptada") {
        aceptadas += 1;
        vendido += partidas.reduce((s, x) => s + x.cantidad * x.precio, 0);
      }
    }
    return {
      productoId: p.id,
      nombre: p.nombre,
      interesados: interesados.size,
      conFotos: conFotos.size,
      cotizadas,
      aceptadas,
      cierre: porcentajeCierre(aceptadas, cotizadas),
      vendido: Math.round(vendido * 100) / 100,
    };
  });
  filas.sort((a, b) => b.interesados - a.interesados || b.cotizadas - a.cotizadas);
  return { filas, moneda: config.moneda, sinLista: false };
}
