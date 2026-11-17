import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, CalendarDays, FileText, MessageSquareText, Package } from "lucide-react";
import { getSessionOrNull } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { formatoDinero, type CotizacionDto } from "@/lib/cotizaciones";
import { fichaEntries, fichaLabel, fichaValueText } from "@/lib/ficha";
import type { FichaDto } from "@/lib/types";
import type { PedidoDto } from "@/lib/pedidos";
import { textoDeMensaje } from "@/lib/resumen-traspaso";
import { formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoChip } from "@/components/settings/cotizaciones-client";
import { businessTimezone } from "@/server/analytics/period";
import { agendaEnabled } from "@/server/agenda/flag";
import { getContactById, getContactStage } from "@/server/contacts";
import { cotizacionesEnabled } from "@/server/cotizaciones/flag";
import { listarCotizaciones } from "@/server/cotizaciones/store";
import { pedidosEnabled } from "@/server/pedidos/flag";
import { aDto as pedidoADto, leerConfig as leerConfigPedidos, listarPedidos } from "@/server/pedidos/store";

export const dynamic = "force-dynamic";

const ESTADO_CITA: Record<string, string> = {
  agendada: "Agendada",
  realizada: "Se hizo",
  no_show: "No llegó",
  cancelada: "Cancelada",
};

const TIPO_PAGO: Record<string, string> = { anticipo: "Anticipo", abono: "Abono", liquidacion: "Liquidación" };

/**
 * Módulo de la agencia — un cliente completo en una sola pantalla: sus datos,
 * la ficha, lo último que se dijo, sus cotizaciones, sus pedidos con pagos y
 * saldo, y sus citas. Solo lectura: lo que se cambia, se cambia donde vive
 * (la conversación, Pedidos, Citas), con un enlace directo a cada lugar.
 */
export default async function ContactoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionOrNull();
  if (!session) notFound();
  const org = session.organizationId;
  const { id } = await params;
  const contacto = await getContactById(org, id);
  if (!contacto) notFound();

  const db = getDb();
  const [etapa, zona, conversaciones] = await Promise.all([
    getContactStage(org, id),
    businessTimezone(org),
    db
      .select({ id: schema.conversation.id, lastMessageAt: schema.conversation.lastMessageAt, isTest: schema.conversation.isTest })
      .from(schema.conversation)
      .where(scoped(schema.conversation.organizationId, org, eq(schema.conversation.contactId, id)))
      .orderBy(desc(schema.conversation.lastMessageAt)),
  ]);
  const convIds = conversaciones.map((c) => c.id);
  const principal = conversaciones.find((c) => !c.isTest) ?? conversaciones[0] ?? null;

  const [mensajes, cotizaciones, pedidos, citas] = await Promise.all([
    principal
      ? db
          .select({
            id: schema.message.id,
            direction: schema.message.direction,
            type: schema.message.type,
            text: schema.message.text,
            createdAt: schema.message.createdAt,
          })
          .from(schema.message)
          .where(scoped(schema.message.organizationId, org, eq(schema.message.conversationId, principal.id)))
          .orderBy(desc(schema.message.createdAt))
          .limit(8)
      : Promise.resolve([]),
    cotizacionesEnabled() && convIds.length > 0
      ? Promise.all(convIds.map((c) => listarCotizaciones(org, { conversationId: c, limite: 50 }))).then((l) =>
          l.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        )
      : Promise.resolve([] as CotizacionDto[]),
    pedidosEnabled() && convIds.length > 0
      ? Promise.all([leerConfigPedidos(org), ...convIds.map((c) => listarPedidos(org, { conversationId: c }))]).then(
          ([config, ...listas]) =>
            (listas as Awaited<ReturnType<typeof listarPedidos>>[]).flat().map((f) => pedidoADto(f, config as never))
        )
      : Promise.resolve([] as PedidoDto[]),
    agendaEnabled()
      ? db
          .select({
            id: schema.booking.id,
            status: schema.booking.status,
            scheduledAt: schema.booking.scheduledAt,
            meetingLink: schema.booking.meetingLink,
            notes: schema.booking.notes,
          })
          .from(schema.booking)
          .where(
            scoped(
              schema.booking.organizationId,
              org,
              and(eq(schema.booking.contactId, id), inArray(schema.booking.kind, ["session"]))
            )
          )
          .orderBy(desc(schema.booking.scheduledAt))
          .limit(20)
      : Promise.resolve([]),
  ]);

  const fecha = (d: Date | string) =>
    new Intl.DateTimeFormat("es-MX", { timeZone: zona, day: "numeric", month: "short", year: "numeric" }).format(
      new Date(d)
    );
  const fechaHora = (d: Date | string) =>
    new Intl.DateTimeFormat("es-MX", {
      timeZone: zona,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(d));
  const ficha = fichaEntries((contacto.ficha ?? {}) as FichaDto);
  const monto = etapa?.lead.amountCents != null ? etapa.lead.amountCents / 100 : null;
  const moneda = etapa?.lead.currency === "USD" ? "USD" : "MXN";
  const chat = principal ? `/inbox?conversation=${principal.id}` : `/inbox?contact=${id}`;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-4 sm:p-6">
      <Link href="/contacts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Contactos
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <ContactAvatar name={contacto.name} seed={contacto.id} />
        <div className="min-w-[60%] flex-1 sm:min-w-0">
          <h1 className="break-words text-xl font-semibold">{contacto.name}</h1>
          <p className="text-sm text-muted-foreground">{formatPhone(contacto.phone)}</p>
        </div>
        <Link
          href={chat}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          <MessageSquareText className="h-4 w-4" /> Abrir conversación
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {etapa && <Badge variant="outline">Etapa: {etapa.stage.name}</Badge>}
        {monto !== null && <Badge variant="outline">Trato: {formatoDinero(monto, moneda)}</Badge>}
        {contacto.archivedAt && <Badge variant="secondary">Archivado</Badge>}
      </div>

      {(ficha.length > 0 || contacto.notes) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lo que sabemos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {ficha.length > 0 && (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {ficha.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-muted-foreground">{fichaLabel(k)}:</dt>
                    <dd className="min-w-0 break-words">{fichaValueText(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {contacto.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2">{contacto.notes}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareText className="h-4 w-4" /> Conversación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {mensajes.length === 0 ? (
            <p className="text-muted-foreground">Todavía no hay mensajes.</p>
          ) : (
            [...mensajes].reverse().map((m) => (
              <div key={m.id} className={m.direction === "out" ? "flex justify-end" : "flex"}>
                <p
                  className={
                    m.direction === "out"
                      ? "max-w-[85%] rounded-lg bg-primary/10 px-2.5 py-1.5"
                      : "max-w-[85%] rounded-lg bg-muted px-2.5 py-1.5"
                  }
                >
                  <span className="line-clamp-3">{textoDeMensaje(m.type, m.text)}</span>
                  <span className="block text-[11px] text-muted-foreground">{fechaHora(m.createdAt)}</span>
                </p>
              </div>
            ))
          )}
          <Link href={chat} className="inline-block pt-1 text-sm text-primary hover:underline">
            Ver la conversación completa →
          </Link>
        </CardContent>
      </Card>

      {cotizacionesEnabled() && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Cotizaciones
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {cotizaciones.length === 0 ? (
              <p className="text-muted-foreground">Sin cotizaciones.</p>
            ) : (
              cotizaciones.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                  <span className="font-medium">{c.folio}</span>
                  <EstadoChip estado={c.estado} />
                  <span className="text-muted-foreground">{fecha(c.enviadaEn ?? c.createdAt)}</span>
                  <span className="ml-auto font-medium">{formatoDinero(c.totales.total, c.moneda)}</span>
                  <a
                    href={`/api/cotizaciones/${c.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    PDF
                  </a>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {pedidosEnabled() && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" /> Pedidos y pagos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {pedidos.length === 0 ? (
              <p className="text-muted-foreground">Sin pedidos.</p>
            ) : (
              pedidos.map((p) => (
                <div key={p.id} className="space-y-1.5 rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.folio}</span>
                    <Badge variant="outline">{p.etapaNombre}</Badge>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.concepto}</span>
                    <Link href="/pedidos" className="text-primary hover:underline">
                      Abrir
                    </Link>
                  </div>
                  {p.monto !== null && (
                    <p>
                      Total {formatoDinero(p.monto)} · Pagado {formatoDinero(p.pagado)} ·{" "}
                      {p.liquidado ? (
                        <span className="font-medium text-emerald-600">Liquidado</span>
                      ) : (
                        <span className="font-medium">Saldo {formatoDinero(p.saldo ?? 0)}</span>
                      )}
                      {!p.liquidado && p.cobrarSaldoEl && (
                        <span className="text-muted-foreground"> · cobrar el {fecha(`${p.cobrarSaldoEl}T12:00:00Z`)}</span>
                      )}
                    </p>
                  )}
                  {p.pagos.length > 0 && (
                    <ul className="space-y-0.5 text-muted-foreground">
                      {p.pagos.map((g) => (
                        <li key={g.id}>
                          {TIPO_PAGO[g.tipo] ?? "Pago"} · {formatoDinero(g.monto)} · {fecha(`${g.fecha}T12:00:00Z`)}
                          {g.nota ? ` · ${g.nota}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {agendaEnabled() && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> Citas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {citas.length === 0 ? (
              <p className="text-muted-foreground">Sin citas.</p>
            ) : (
              citas.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                  <span className="font-medium">{fechaHora(b.scheduledAt)}</span>
                  <Badge variant="outline">{ESTADO_CITA[b.status] ?? b.status}</Badge>
                  {b.meetingLink && (
                    <a href={b.meetingLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      Enlace
                    </a>
                  )}
                  {b.notes && <span className="w-full text-muted-foreground">{b.notes}</span>}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
