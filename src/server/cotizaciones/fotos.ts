import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Partida, Producto } from "@/lib/cotizaciones";
import { clavesDeProductos, esDelProducto } from "@/lib/por-modelo";
import { bibliotecaEnabled } from "@/server/biblioteca/flag";
import { archivo, asegurarTablas, leerBinario } from "@/server/biblioteca/store";

/**
 * Módulo de la agencia — las fotos que van en el PDF de una cotización: por
 * cada modelo cotizado (los extras como el flete no), la primera foto activa
 * de la Biblioteca que es suya. Solo JPG o PNG (lo que sabe dibujar el PDF),
 * hasta 3 y de hasta 4 MB cada una. Si algo falla, la cotización sale sin
 * fotos: nunca truena.
 */
const MAX_FOTOS = 3;
const MAX_BYTES = 4 * 1024 * 1024;

export async function fotosParaCotizacion(
  organizationId: string,
  partidas: readonly Partida[],
  productos: readonly Producto[]
): Promise<{ data: Buffer; mime: string; titulo: string }[]> {
  if (!bibliotecaEnabled()) return [];
  try {
    const modelos = productos.filter((p) => !p.extra);
    if (modelos.length === 0) return [];
    const claves = clavesDeProductos(modelos);
    // Los modelos de la cotización, del de mayor importe al menor, sin repetir.
    const orden = [...partidas].sort((a, b) => b.cantidad * b.precio - a.cantidad * a.precio);
    const elegidos: Producto[] = [];
    for (const p of orden) {
      const m = modelos.find((x) => esDelProducto(p, x, claves.get(x.id) ?? []));
      if (m && !elegidos.some((e) => e.id === m.id)) elegidos.push(m);
    }
    if (elegidos.length === 0) return [];

    await asegurarTablas();
    const imagenes = await getDb()
      .select({ id: archivo.id, titulo: archivo.titulo, mime: archivo.mime, tamano: archivo.tamano })
      .from(archivo)
      .where(
        scoped(
          archivo.organizationId,
          organizationId,
          and(eq(archivo.activo, true), inArray(archivo.mime, ["image/jpeg", "image/png"]))
        )
      );

    const fotos: { data: Buffer; mime: string; titulo: string }[] = [];
    for (const m of elegidos) {
      if (fotos.length >= MAX_FOTOS) break;
      const suya = imagenes.find(
        (a) => a.tamano <= MAX_BYTES && esDelProducto({ concepto: a.titulo }, m, claves.get(m.id) ?? [])
      );
      if (!suya) continue;
      const data = await leerBinario(organizationId, suya.id).catch(() => null);
      if (data) fotos.push({ data, mime: suya.mime, titulo: m.nombre });
    }
    return fotos;
  } catch (err) {
    console.warn("[cotizaciones] no se pudieron leer las fotos de la Biblioteca:", err);
    return [];
  }
}
