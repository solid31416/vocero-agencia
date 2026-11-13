/**
 * Módulo de la agencia (Treviño AI) — «Tu cuenta → Contraseña».
 *
 * El CRM no traía forma de cambiar la contraseña desde la app: había que
 * tocar la base. Better Auth ya expone `/change-password` (pide la actual);
 * aquí solo vive la validación del formulario, pura para poder probarla.
 */

/** Igual que `emailAndPassword.minPasswordLength` en `src/lib/auth/index.ts`. */
export const MIN_CONTRASENA = 8;
/** Igual que el máximo que acepta Ajustes → Equipo. */
export const MAX_CONTRASENA = 128;

export type CambioContrasena = {
  actual: string;
  nueva: string;
  confirmar: string;
};

/** Devuelve el primer problema del formulario, o `null` si se puede enviar. */
export function problemaDelCambio({ actual, nueva, confirmar }: CambioContrasena): string | null {
  if (!actual) return "Escribe tu contraseña actual.";
  if (nueva.length < MIN_CONTRASENA) {
    return `La contraseña nueva necesita al menos ${MIN_CONTRASENA} caracteres.`;
  }
  if (nueva.length > MAX_CONTRASENA) {
    return `La contraseña nueva puede tener como mucho ${MAX_CONTRASENA} caracteres.`;
  }
  if (nueva.trim() !== nueva) return "La contraseña nueva no puede empezar ni terminar con espacios.";
  if (nueva === actual) return "La contraseña nueva es igual a la actual.";
  if (nueva !== confirmar) return "La confirmación no coincide con la contraseña nueva.";
  return null;
}

/** Traduce el código de error de Better Auth a un mensaje para el dueño. */
export function mensajeDeError(code: string | undefined): string {
  switch (code) {
    case "INVALID_PASSWORD":
      return "La contraseña actual no es correcta.";
    case "PASSWORD_TOO_SHORT":
      return `La contraseña nueva necesita al menos ${MIN_CONTRASENA} caracteres.`;
    case "PASSWORD_TOO_LONG":
      return `La contraseña nueva puede tener como mucho ${MAX_CONTRASENA} caracteres.`;
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return "Esta cuenta no entra con contraseña, así que no hay una que cambiar.";
    default:
      return "No se pudo cambiar la contraseña. Inténtalo de nuevo.";
  }
}
