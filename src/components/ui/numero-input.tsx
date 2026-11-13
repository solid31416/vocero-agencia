"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { ajustarNumero, numeroAlSalir, textoANumero, type LimitesNumero } from "@/lib/numero";

/**
 * Módulos de la agencia (Treviño AI) — un campo de número que se deja borrar
 * y volver a escribir sin que aparezca un 0 delante (ver `src/lib/numero.ts`).
 * Mientras se escribe avisa cada número válido; al salir fija los límites y,
 * si quedó vacío, pone `vacio` (o `min`, o 0). Al entrar selecciona todo, así
 * escribir reemplaza el valor en vez de pegarse a él.
 */
type Props = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "min" | "max"> &
  LimitesNumero & {
    value: number;
    onValueChange: (n: number) => void;
  };

export function NumeroInput({ value, onValueChange, min, max, entero, vacio, onBlur, onFocus, ...rest }: Props) {
  const [texto, setTexto] = useState(() => String(value));

  // Si el número cambia desde fuera (la IA llenó la partida, se eligió un
  // producto), se pinta; si es el mismo que ya dice el texto, se respeta lo
  // escrito («1.» mientras se teclea «1.5»).
  useEffect(() => {
    setTexto((t) => (textoANumero(t) === value ? t : String(value)));
  }, [value]);

  const limites = { min, max, entero, vacio };

  return (
    <Input
      {...rest}
      type="number"
      inputMode={entero ? "numeric" : "decimal"}
      min={min}
      max={max}
      value={texto}
      onFocus={(e) => {
        e.target.select();
        onFocus?.(e);
      }}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = textoANumero(e.target.value);
        if (n !== null) onValueChange(ajustarNumero(n, { max }));
      }}
      onBlur={(e) => {
        const final = numeroAlSalir(texto, limites);
        setTexto(String(final));
        if (final !== value) onValueChange(final);
        onBlur?.(e);
      }}
    />
  );
}
