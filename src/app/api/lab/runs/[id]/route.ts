import { asc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { PERSONA_LABELS } from "@/server/lab/personas";
import { esClientePropio } from "@/lib/lab-a-la-medida";
import { listarClientes } from "@/server/lab/a-la-medida/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(
      scoped(
        schema.agentTestRun.organizationId,
        session.organizationId,
        eq(schema.agentTestRun.id, id)
      )
    )
    .limit(1);
  const run = runs[0];
  if (!run) return apiError(404, "not_found", "Corrida no encontrada");

  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(eq(schema.agentTestCase.runId, id))
    .orderBy(asc(schema.agentTestCase.createdAt));

  // Módulo de la agencia: el nombre de los clientes propios. Si ya se borró
  // o se cambió, la corrida vieja dice que era uno a la medida.
  const nombres = new Map<string, string>();
  if (cases.some((c) => esClientePropio(c.persona))) {
    const propios = await listarClientes(session.organizationId).catch(() => []);
    for (const c of propios) nombres.set(c.id, c.nombre);
  }
  const etiqueta = (clave: string) =>
    PERSONA_LABELS[clave] ??
    nombres.get(clave) ??
    (esClientePropio(clave) ? "Cliente a la medida (ya no existe)" : clave);

  return Response.json({
    run: {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
    cases: cases.map((c) => ({
      id: c.id,
      persona: c.persona,
      personaLabel: etiqueta(c.persona),
      status: c.status,
      veredicto: c.veredicto,
      hallazgos: c.hallazgos ?? [],
      transcript: c.transcript ?? [],
    })),
  });
});
