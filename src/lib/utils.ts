import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Title case: primeira letra de cada palavra em maiúscula. */
export function titleCase(str: string): string {
  return str
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part.trim()) return part;
      const chars = Array.from(part);
      return chars[0]!.toUpperCase() + chars.slice(1).join("").toLowerCase();
    })
    .join("");
}

/** Nome normalizado para comparar pessoas entre abas (sem acento, minúsculo, trim). */
export function normalizarNome(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
