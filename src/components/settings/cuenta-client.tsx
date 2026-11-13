"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth/client";
import { MIN_CONTRASENA, mensajeDeError, problemaDelCambio } from "@/lib/cuenta";

/**
 * Módulo de la agencia (Treviño AI) — Ajustes → Tu cuenta → Contraseña.
 * Cada quien cambia la suya: pide la actual (Better Auth la verifica) y, al
 * cambiarla, cierra las demás sesiones abiertas de esa cuenta.
 */
export function CuentaClient() {
  const { data } = useSession();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const problema = problemaDelCambio({ actual, nueva, confirmar });

  async function cambiar() {
    if (problema) return setError(problema);
    setGuardando(true);
    setError(null);
    setListo(false);
    const res = await authClient
      .changePassword({ currentPassword: actual, newPassword: nueva, revokeOtherSessions: true })
      .catch(() => null);
    setGuardando(false);
    if (!res || res.error) {
      setError(mensajeDeError(res?.error?.code));
      return;
    }
    setActual("");
    setNueva("");
    setConfirmar("");
    setListo(true);
  }

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>
            {data?.user?.email ? (
              <>
                Es la contraseña con la que entra <strong>{data.user.email}</strong>.{" "}
              </>
            ) : null}
            Al cambiarla se cierran tus otras sesiones abiertas (otro navegador o el celular); esta
            sigue abierta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void cambiar();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cuenta-actual">Contraseña actual</Label>
              <Input
                id="cuenta-actual"
                type="password"
                autoComplete="current-password"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cuenta-nueva">Contraseña nueva</Label>
              <Input
                id="cuenta-nueva"
                type="password"
                autoComplete="new-password"
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                aria-describedby="cuenta-nueva-ayuda"
              />
              <p id="cuenta-nueva-ayuda" className="text-xs text-muted-foreground">
                Al menos {MIN_CONTRASENA} caracteres.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cuenta-confirmar">Repite la contraseña nueva</Label>
              <Input
                id="cuenta-confirmar"
                type="password"
                autoComplete="new-password"
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {listo && (
              <div role="status" className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
                <p className="font-medium text-success-text">Contraseña cambiada ✓</p>
                <p className="mt-1 text-success-text opacity-90">
                  La próxima vez entra con la nueva. Si la tenías anotada en otro lado, actualízala
                  ahí también.
                </p>
              </div>
            )}
            <Button type="submit" disabled={guardando || problema !== null}>
              <KeyRound className="h-4 w-4" />
              {guardando ? "Cambiando…" : "Cambiar contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
