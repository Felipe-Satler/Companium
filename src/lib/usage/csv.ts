/** CSV no padrão das outras exportações do Companium: ";" como separador, vírgula decimal,
 *  BOM UTF-8 (o Excel abre com acento certo). */

type Celula = string | number | null | undefined;

const celula = (v: Celula) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function montarCsv(cabecalho: string[], linhas: Celula[][]): string {
  return [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}

export function baixarCsv(conteudo: string, nomeArquivo: string) {
  const blob = new Blob([`\uFEFF${conteudo}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
