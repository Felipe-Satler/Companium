import { AlertTriangle } from "lucide-react";
import { MetaCardsCtx, META_LABELS } from "@/hooks/useClientesMetas";
import { prettyClientLabel } from "@/data/clienteAliases";

/**
 * Banner âmbar de "preencher metas":
 *  - cliente único com campos zerados no mês → lista os campos a preencher;
 *  - visão "Todos os clientes" → lista os clientes totalmente zerados no mês.
 * Some quando não há nada pendente. Sempre referente ao mês-âncora (mês do filtro).
 */
export function MetasAlert({ metas, clienteLabel }: { metas: MetaCardsCtx; clienteLabel?: string }) {
  const show =
    (metas.editable && metas.missingFields.length > 0) ||
    (!metas.editable && metas.missingClients.length > 0);
  if (!show) return null;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
      {metas.editable ? (
        <p>
          Planejado de <span className="font-semibold">{metas.monthLabel}</span>
          {clienteLabel ? <> de <span className="font-semibold">{clienteLabel}</span></> : null} ainda não preenchido:{" "}
          <span className="font-semibold">{metas.missingFields.map((f) => META_LABELS[f]).join(", ")}</span>. Clique na
          caixa <span className="font-semibold">Planejado</span> de cada card para preencher.
        </p>
      ) : (
        <p>
          <span className="font-semibold">{metas.missingClients.length}</span> cliente(s) sem planejado de{" "}
          <span className="font-semibold">{metas.monthLabel}</span>:{" "}
          <span className="font-semibold">
            {metas.missingClients.slice(0, 12).map(prettyClientLabel).join(", ")}
            {metas.missingClients.length > 12 ? ` +${metas.missingClients.length - 12}` : ""}
          </span>
          . Selecione um cliente no filtro para preencher.
        </p>
      )}
    </div>
  );
}
