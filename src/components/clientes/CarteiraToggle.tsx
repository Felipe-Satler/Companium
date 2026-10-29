import { useEffect } from "react";
import { Users, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClientesFilters } from "@/contexts/ClientesFiltersContext";
import { setIncluirInativos } from "@/data/clientesVisiveisStore";

/**
 * Alterna a carteira entre "Ativos" e "Histórico" nas telas de /clientes.
 *
 *   Ativos    (padrão) — só quem está ATIVO na planilha de projetos.
 *   Histórico          — todo mundo que já teve dado, inclusive cliente encerrado.
 *
 * O recorte é COMPARTILHADO entre CRM, Meta Ads, Google Ads e Metas, como já são o período e
 * a origem: manter recortes diferentes por aba faria dois totais da mesma carteira aparecerem
 * lado a lado sem nada explicando a diferença.
 *
 * A escolha vive no contexto (persistida em localStorage) e é espelhada no store de módulo,
 * que é quem o isExcludedClient consulta — o efeito abaixo é essa ponte.
 */
export function CarteiraToggle({ className }: { className?: string }) {
  const { filters, patch } = useClientesFilters();
  const apenasAtivos = filters.apenasAtivos !== false; // undefined (estado salvo antigo) = ativos

  useEffect(() => {
    setIncluirInativos(!apenasAtivos);
  }, [apenasAtivos]);

  const opcoes = [
    { ativo: true, label: "Ativos", Icon: Users, title: "Só clientes ATIVO na planilha de projetos" },
    { ativo: false, label: "Histórico", Icon: History, title: "Todos os clientes que já tiveram dados, inclusive encerrados" },
  ];

  return (
    <div className={cn("neu-inset inline-flex items-center gap-1 p-1 rounded-lg", className)}>
      {opcoes.map((o) => {
        const on = apenasAtivos === o.ativo;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => patch({ apenasAtivos: o.ativo })}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              on ? "neu-button text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <o.Icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
