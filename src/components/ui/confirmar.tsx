"use client";

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";

/**
 * Módulo de la agencia — confirmación dentro de la página, en lugar de
 * `window.confirm`. Algunos navegadores (el panel integrado de una app, una
 * pestaña que bloqueó los diálogos) contestan «No» solos sin mostrar nada, y
 * el botón parece no hacer nada. Esta ventana es del CRM: sale siempre.
 *
 *   if (!(await confirmar("¿Quitar el pago?", { accion: "Sí, quitar" }))) return;
 */

type Opciones = { accion?: string; cancelar?: string };

function Ventana({ pregunta, accion, cancelar, responder }: { pregunta: string; accion: string; cancelar: string; responder: (ok: boolean) => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        responder(false);
      }
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [responder]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirmar"
      data-confirmar
      onClick={(e) => e.target === e.currentTarget && responder(false)}
    >
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-4 shadow-lg">
        <p className="whitespace-pre-line text-sm">{pregunta}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button autoFocus type="button" variant="ghost" size="sm" onClick={() => responder(false)} data-confirmar-no>
            {cancelar}
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => responder(true)} data-confirmar-si>
            {accion}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function confirmar(pregunta: string, opciones: Opciones = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const nodo = document.createElement("div");
    document.body.appendChild(nodo);
    const root = createRoot(nodo);
    let listo = false;
    const responder = (ok: boolean) => {
      if (listo) return;
      listo = true;
      resolve(ok);
      // Se desmonta después del clic, no durante.
      setTimeout(() => {
        root.unmount();
        nodo.remove();
      }, 0);
    };
    root.render(
      <Ventana
        pregunta={pregunta}
        accion={opciones.accion ?? "Sí, quitar"}
        cancelar={opciones.cancelar ?? "Cancelar"}
        responder={responder}
      />
    );
  });
}
