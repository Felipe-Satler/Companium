import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2, Microscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PassosDoCriativo } from "@/components/marketing/mineracao/PassosDoCriativo";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DissecacaoCriativo } from "@/components/marketing/mineracao/DissecacaoCriativo";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { useAtualizarCriativo, useCriativo } from "@/hooks/useAdSpy";

type Props = {
  criativoId: string;
  nome: string;
  /** A especialidade do cliente, para vir preenchida — basta confirmar. */
  especialidadePadrao?: string;
  /** Dissecação pronta e salva: segue para a composição com ela. */
  onPronto: (criativoId: string) => void;
  /** Dissecação impossível: compor sem o criativo. */
  onSemCriativo: () => void;
  /**
   * Há outra análise de criativo escolhida para compor sem esta? Desde 20/10/2026 ao menos uma é
   * obrigatória, então sem nenhuma outra a única saída é voltar aos insumos.
   */
  podeComporSem?: boolean;
  onVoltar: () => void;
};

/**
 * A etapa extra antes de compor, quando o criativo interno escolhido ainda não tinha dissecação:
 * o agente de análises disseca, a pessoa escolhe a especialidade em que a análise fica salva, e só
 * então a composição começa (decisão do usuário, 19/10/2026).
 *
 * Cada passo aparece, com o atual girando: buscar o vídeo e transcrever levam minutos, e uma tela
 * parada sem dizer o que espera é indistinguível de uma tela travada.
 */
export function PreparoCriativo({
  criativoId,
  nome,
  especialidadePadrao,
  onPronto,
  onSemCriativo,
  podeComporSem = true,
  onVoltar,
}: Props) {
  const { criativo } = useCriativo(criativoId);
  const atualizar = useAtualizarCriativo();
  const { especialidadeOptions, loading } = useEspecialidades();
  const [especialidade, setEspecialidade] = useState(especialidadePadrao ?? "");
  useEffect(() => {
    if (!especialidade && especialidadePadrao) setEspecialidade(especialidadePadrao);
  }, [especialidadePadrao, especialidade]);
  const options = useMemo(() => especialidadeOptions.map((e) => ({ value: e, label: e })), [especialidadeOptions]);

  const status = criativo?.status ?? "running";
  // O nome com que a análise fica em Análises de Criativos: começa com o do anúncio, e dá para
  // trocar aqui mesmo, junto com a especialidade.
  const [titulo, setTitulo] = useState(nome);

  const salvar = () => {
    atualizar.mutate(
      { id: criativoId, especialidade, titulo: titulo.trim() || undefined },
      {
        onSuccess: () => onPronto(criativoId),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível salvar a especialidade"),
      },
    );
  };

  return (
    <section aria-label="Preparando o criativo" className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-2">
        <Microscope className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Antes de compor: dissecar “{nome}”</h3>
          <p className="text-xs text-muted-foreground">
            Este criativo do cliente ainda não tinha dissecação. Ela é feita agora, salva em Análises
            de Criativos, e entra na composição.
          </p>
        </div>
      </div>

      {status === "running" && (
        <PassosDoCriativo etapa={criativo?.etapa ?? null} desde={criativo?.atualizado_em ?? null} interno />
      )}

      {status === "error" && (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {criativo?.error || "Dissecação não é possível."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onVoltar}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Voltar aos insumos
            </Button>
            {podeComporSem && (
              <Button size="sm" onClick={onSemCriativo}>
                Compor sem o criativo
              </Button>
            )}
          </div>
          {!podeComporSem && (
            <p className="text-xs text-muted-foreground">
              Sem ele não há análise de criativo para compor: escolha outra nos insumos.
            </p>
          )}
        </div>
      )}

      {status === "done" && criativo && (
        <div className="space-y-4">
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-card p-3">
            <DissecacaoCriativo criativo={criativo} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium">Com que nome e em que especialidade salvar esta análise?</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
                aria-label="Nome da análise"
                className="h-9 min-w-[14rem] flex-1 text-xs sm:max-w-xs"
              />
              <div className="min-w-[16rem] flex-1 sm:max-w-sm">
                <SearchableSelect
                  value={especialidade}
                  onValueChange={setEspecialidade}
                  options={options}
                  placeholder={loading ? "Carregando…" : "Escolha a especialidade"}
                  searchPlaceholder="Buscar especialidade…"
                  emptyText="Nenhuma especialidade encontrada."
                  allOption={null}
                  triggerClassName="w-full"
                />
              </div>
              <Button size="sm" onClick={salvar} disabled={!especialidade || atualizar.isPending}>
                {atualizar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Salvar e compor
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
