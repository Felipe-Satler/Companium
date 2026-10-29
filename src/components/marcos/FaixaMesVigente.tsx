import { useRef, useState, type CSSProperties } from "react";
import { Pencil } from "lucide-react";
import type { BIMes } from "@/components/gestao/useGestaoBI";
import type { IndicadorMarco, MetasMarcos } from "@/lib/marcosMetas";
import { INDICADORES_MARCOS, atingimentoMarco, formatarMarco, formatarMarcoAbreviado } from "./indicadores";
import { classificarMeta, type FaixaMeta } from "./painelExecutivo";

const classeFaixa: Record<FaixaMeta, string> = {
  superada: "text-primary",
  atingida: "text-success",
  "nao-batida": "text-destructive",
};

function BarraMeta({ percentual, faixa }: { percentual: number | null; faixa: FaixaMeta | null }) {
  const valor = percentual ?? 0;
  // Escala proporcional quando há estouro: o marcador preserva o limite dos 100%.
  const escala = Math.max(100, valor);
  const limite = (100 / escala) * 100;
  const largura = (Math.max(0, Math.min(100, valor)) / escala) * 100;
  const excesso = (Math.max(0, valor - 100) / escala) * 100;
  const estilo = { "--meta-fill": `${largura}%`, "--meta-limit": `${limite}%`, "--meta-overflow": `${excesso}%` } as CSSProperties;
  return (
    <div className={`flex items-center gap-3 ${faixa ? classeFaixa[faixa] : "text-muted-foreground"}`}>
      <div
        className="marcos-current-track relative h-2 min-w-0 flex-1 rounded-sm"
        style={estilo}
        role="meter"
        aria-label="Realizado sobre planejado"
        aria-valuemin={0}
        aria-valuemax={escala}
        aria-valuenow={valor}
        aria-valuetext={percentual === null ? "Sem dado ainda" : formatarMarco(percentual, "percentual")}
        data-meta-overflow={valor > 100}
      >
        <span className="marcos-current-fill absolute inset-y-0 left-0 rounded-sm" />
        {valor > 100 && <>
          <span className="marcos-current-overflow absolute inset-y-0 right-0 rounded-r-sm" />
          <span className="marcos-current-limit absolute -top-1 h-4 w-px bg-foreground" title="100% da meta" />
        </>}
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums" data-meta-percentual>
        {percentual === null ? "—" : formatarMarco(percentual, "percentual")}
      </span>
    </div>
  );
}

function PlanejadoEditavel({ meta, formato, nome, parseValor, onSave }: {
  meta: number | undefined;
  formato: Parameters<typeof formatarMarco>[1];
  nome: string;
  parseValor: (texto: string) => number | null;
  onSave: (valor: number | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const cancelado = useRef(false);
  const abrir = () => {
    cancelado.current = false;
    setTexto(meta === undefined ? "" : String(meta).replace(".", ","));
    setEditando(true);
  };
  const confirmar = () => {
    if (cancelado.current) { setEditando(false); return; }
    const vazio = texto.trim() === "";
    const valor = parseValor(texto);
    if (vazio) onSave(null);
    else if (valor !== null) onSave(valor);
    setEditando(false);
  };
  return (
    <div className="mt-2 flex min-h-8 items-center gap-2 text-sm leading-5 text-muted-foreground">
      {editando ? (
        <input
          autoFocus
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { cancelado.current = true; e.currentTarget.blur(); }
          }}
          aria-label={`Planejado de ${nome} no mês vigente`}
          className="marcos-goal-pill h-8 w-36 rounded-md px-2 text-sm font-semibold tabular-nums text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <p>
          {meta === undefined ? "sem meta definida" : <>de <span className="font-semibold tabular-nums text-foreground" title={formatarMarco(meta, formato)}>{formatarMarcoAbreviado(meta, formato)}</span> <span>PLANEJADO</span></>}
        </p>
      )}
      {!editando && (
        <button type="button" onClick={abrir} aria-label={`Editar planejado de ${nome} no mês vigente`} className="rounded p-1 text-foreground opacity-90 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function FaixaMesVigente({ atual, mes, metas, temRealizado, loading, parseValor, onSalvarMeta }: {
  atual: string;
  mes: BIMes | undefined;
  metas: MetasMarcos;
  temRealizado: (indicador: IndicadorMarco) => boolean;
  loading: boolean;
  parseValor: (texto: string) => number | null;
  onSalvarMeta: (indicador: IndicadorMarco, valor: number | null) => void;
}) {
  const [ano = "", numeroMes = "1"] = atual.split("-");
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(Number(ano), Number(numeroMes) - 1, 1)));
  const titulo = `${nomeMes.charAt(0).toUpperCase()}${nomeMes.slice(1)}/${ano}`;
  return (
    <section aria-labelledby="mes-vigente-titulo" data-marcos-vigente={atual}>
      <h2 id="mes-vigente-titulo" className="mb-4 text-base font-semibold text-foreground">Metas do mês vigente · {titulo}</h2>
      <div className="marcos-current-grid grid gap-4">
        {INDICADORES_MARCOS.map((indicador) => {
          const meta = metas[indicador.chave]?.[atual];
          const real = !loading && mes && temRealizado(indicador.chave) ? indicador.realizado(mes) : null;
          const percentual = real !== null ? atingimentoMarco(real, meta) : null;
          const faixa = real !== null && meta !== undefined ? classificarMeta(real, meta, indicador.menorMelhor) : null;
          return (
            <article key={indicador.chave} data-marcos-vigente-indicador={indicador.chave} className="neu-card flex min-w-0 flex-col rounded-lg p-5">
              <h3 className="min-h-8 text-sm font-semibold uppercase leading-5 tracking-wide text-muted-foreground">{indicador.nome}</h3>
              <p data-meta-realizado className="mt-1 flex items-baseline gap-2 whitespace-nowrap text-2xl font-bold tabular-nums text-foreground" title={real === null ? undefined : formatarMarco(real, indicador.formato)}>
                <span>{real === null ? "—" : formatarMarcoAbreviado(real, indicador.formato)}</span>
                <span data-meta-rotulo className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">realizado</span>
              </p>
              <PlanejadoEditavel
                meta={meta}
                formato={indicador.formato}
                nome={indicador.nome}
                parseValor={parseValor}
                onSave={(valor) => onSalvarMeta(indicador.chave, valor)}
              />
              <div className="mt-auto pt-3">
                {meta !== undefined && meta !== 0 && <BarraMeta percentual={percentual} faixa={faixa} />}
                <p className="mt-2 min-h-4 text-[11px] text-muted-foreground">{loading ? "Carregando…" : real === null ? "sem dado ainda" : ""}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}