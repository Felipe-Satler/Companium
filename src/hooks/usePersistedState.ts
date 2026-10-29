import { useEffect, useRef, useState } from "react";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

// JSON revives ISO strings back to Date. JSON.parse runs the reviver on every key
// including the root, so top-level Date values are handled too.
function reviver(_key: string, value: unknown) {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

// Wrap em { v } pra que `undefined` no topo (ex.: dateFrom: undefined) também sobreviva
// ao round-trip — JSON.stringify(undefined) sozinho devolve undefined.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw, reviver) as { v: T } | null;
    if (parsed && typeof parsed === "object" && "v" in parsed) return parsed.v;
  } catch {
    /* corrupt JSON / storage indisponível — usa fallback */
  }
  return fallback;
}

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: value }));
  } catch {
    /* quota / storage desabilitado */
  }
}

/**
 * Mantém filtros (e outros estados) vivos entre reloads via localStorage.
 * Drop-in replacement de useState — assinatura idêntica, exceto pela chave.
 */
export function usePersistedState<T>(
  storageKey: string,
  initializer: () => T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => load(storageKey, initializer()));

  // Evita gravar no primeiro render quando o valor já veio do storage.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    save(storageKey, state);
  }, [storageKey, state]);

  return [state, setState];
}
