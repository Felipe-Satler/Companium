import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Microscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { useStartCriativo } from "@/hooks/useAdSpy";
import type { OrigemCriativo, SpyAd } from "@/lib/adSpyApi";
import { tituloPadraoCriativo } from "@/components/marketing/mineracao/criativoTexto";


/**
 * "Analisar Criativo": a dissecação de UM anúncio pelo spyagent, salva em Mineração › Análises de
 * Criativos.
 *
 * Pede nome e especialidade antes, como o "Salvar na Biblioteca": a análise é salva por
 * especialidade e achada por ela. Vindo de uma Mineração Salva, a especialidade já vem com a dela.
 *
 * Sem `origem` (a tela não sabe de onde a peça veio) o botão não aparece: o worker precisa da busca
 * ou da mineração salva para achar o anúncio e conferir que ele pertence a ela.
 */
export function AnalisarCriativoButton({
  ad,
  origem,
  especialidadePadrao,
}: {
  ad: SpyAd;
  origem?: OrigemCriativo;
  especialidadePadrao?: string;
}) {
  const navigate = useNavigate();
  const start = useStartCriativo();
  const { especialidadeOptions, loading } = useEspecialidades();
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [especialidade, setEspecialidade] = useState("");

  useEffect(() => {
    if (aberto) {
      setTitulo(tituloPadraoCriativo(ad));
      setEspecialidade(especialidadePadrao ?? "");
    }
  }, [aberto, ad, especialidadePadrao]);

  const options = useMemo(
    () => especialidadeOptions.map((e) => ({ value: e, label: e })),
    [especialidadeOptions],
  );

  if (!origem) return null;

  const video = ad.media_type === "video";
  // Sem vídeo não há dissecação (decisão do usuário, 19/10/2026). O botão aparece apagado, dizendo
  // por quê, em vez de sumir — sumido, a pessoa procuraria o botão em outro lugar.
  if (!video) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        disabled
        title="Dissecação não é possível: o anúncio não tem vídeo."
      >
        <Microscope className="mr-1.5 h-3.5 w-3.5" />
        Analisar Criativo (sem vídeo)
      </Button>
    );
  }
  const semFala = video && !(ad.transcript && ad.transcript.trim());

  const analisar = () => {
    start.mutate(
      { ...origem, adId: ad.id, especialidade, titulo: titulo.trim() || undefined },
      {
        onSuccess: (res) => {
          setAberto(false);
          toast.success("Analisando o criativo", {
            description: "O resultado aparece em Análises de Criativos.",
            action: { label: "Abrir", onClick: () => navigate(`/marketing/criativos?criativo=${res.id}`) },
          });
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível analisar o criativo"),
      },
    );
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setAberto(true)}>
        <Microscope className="mr-1.5 h-3.5 w-3.5" />
        Analisar Criativo
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="neu-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Analisar Criativo</DialogTitle>
            <DialogDescription>
              O agente disseca este anúncio em formato, estrutura, anatomia semântica, anatomia
              psicológica e nível de consciência. A análise fica em Análises de Criativos, visível
              para toda a equipe.
              {semFala && " O vídeo ainda não foi transcrito: a fala é transcrita antes, o que leva alguns minutos."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="criativo-titulo" className="text-xs font-medium">
                Nome
              </Label>
              <Input
                id="criativo-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="criativo-especialidade" className="text-xs font-medium">
                Especialidade
              </Label>
              <SearchableSelect
                value={especialidade}
                onValueChange={setEspecialidade}
                options={options}
                placeholder={loading ? "Carregando…" : "Escolha a especialidade"}
                searchPlaceholder="Buscar especialidade…"
                emptyText="Nenhuma especialidade encontrada."
                allOption={null}
                modal
                triggerClassName="w-full"
              />
              {!especialidade && (
                <p className="text-[11px] text-muted-foreground">
                  Obrigatória — é por ela que Análises de Criativos acha esta análise.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={start.isPending}>
              Cancelar
            </Button>
            <Button onClick={analisar} disabled={!especialidade || start.isPending}>
              {start.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Analisar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
