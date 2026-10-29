import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Calendar, Library, PenLine, Search, Star, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { MineracaoSubnav } from "@/components/marketing/mineracao/MineracaoSubnav";
import { AnalysisReport } from "@/components/marketing/mineracao/AnalysisReport";
import { AdCard } from "@/components/marketing/mineracao/AdCard";
import {
  ordenarPorResposta,
  perguntaSalva,
  perguntasSalvas,
  respostaDe,
  rotuloDaPergunta,
} from "@/components/marketing/mineracao/perguntaGrid";
import { CoverMosaico } from "@/components/marketing/mineracao/CoverMosaico";
import { analiseOrganica } from "@/components/marketing/mineracao/relatorioTexto";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { filtrarAnalises } from "@/lib/bibliotecaFiltro";
import {
  useDeleteLibraryEntry,
  useLibrary,
  useToggleFavorite,
  useLibraryEntry,
} from "@/hooks/useAdSpy";
import type { LibraryEntrySummary, SpyAd } from "@/lib/adSpyApi";
import { AvaliacaoControles } from "@/components/marketing/AvaliacaoControles";
import { useAvaliacoes } from "@/hooks/useAvaliacoes";
import type { AvaliacaoItem } from "@/lib/avaliacoesApi";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function EntryCard({
  entry,
  onOpen,
  onDelete,
  onToggleFavorite,
  avaliacao,
}: {
  entry: LibraryEntrySummary;
  onOpen: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  avaliacao?: AvaliacaoItem;
}) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Fora do <button> que abre a análise: botão dentro de botão não é HTML válido, e clicar na
          estrela não pode abrir a análise. */}
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={entry.favorito}
        aria-label={
          entry.favorito
            ? `Remover "${entry.titulo || entry.tema}" dos favoritos`
            : `Favoritar "${entry.titulo || entry.tema}"`
        }
        className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1.5 backdrop-blur transition-colors hover:bg-background"
      >
        <Star
          className={`h-4 w-4 ${
            entry.favorito ? "fill-amber-400 text-amber-500" : "text-muted-foreground"
          }`}
        />
      </button>
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        <CoverMosaico coverAdIds={entry.coverAdIds} />
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-2 text-sm font-semibold">{entry.titulo || entry.tema}</h3>
          {entry.titulo && entry.titulo !== entry.tema && (
            <p className="text-xs text-muted-foreground">Tema: {entry.tema}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {entry.especialidades.map((e) => (
              <span key={e} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {e}
              </span>
            ))}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {entry.saved_by_name || "—"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(entry.criado_em)}
            </span>
            <span>
              {entry.adCount} anúncio{entry.adCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </button>
      {/* Faixa própria, FORA do botão que abre a análise: votar e etiquetar não podem abrir o
          detalhe, e botão dentro de botão não é HTML válido — a mesma razão da estrela lá em cima. */}
      <div className="border-t border-border px-3 py-1.5">
        <AvaliacaoControles alvo="analise" id={entry.id} avaliacao={avaliacao} compacto />
      </div>

      {entry.canDelete && (
        <div className="flex justify-end border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Apagar análise "${entry.titulo || entry.tema}"`}
            className="inline-flex items-center gap-1 rounded p-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Apagar
          </button>
        </div>
      )}
    </article>
  );
}

function EntryDetail({ id, onBack, onDelete }: { id: string; onBack: () => void; onDelete: () => void }) {
  const { entry, isLoading, error } = useLibraryEntry(id);
  // O mesmo cache da listagem: votar aqui já deixa o card certo quando a pessoa voltar.
  const { itens: avaliacoes } = useAvaliacoes("analise");
  const avaliacao = avaliacoes[id];

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !entry) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <p className="text-sm text-destructive">{error || "Análise não encontrada."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Biblioteca
          </Button>
          <h2 className="text-lg font-semibold">{entry.titulo || entry.tema}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {entry.especialidades.map((e) => (
              <span key={e} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {e}
              </span>
            ))}
            <span>
              · tema “{entry.tema}” · salva por {entry.saved_by_name || "—"} em {formatDate(entry.criado_em)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Avaliar DEPOIS de ler é o momento em que a pessoa tem opinião formada — mandá-la voltar
              à Biblioteca para votar é pedir que ela decida de memória. Mesmo componente do card. */}
          <AvaliacaoControles alvo="analise" id={entry.id} avaliacao={avaliacao} />

          {entry.canDelete && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Apagar
            </Button>
          )}

          <Button size="sm" asChild>
            <Link to={`/marketing/composer?analise=${encodeURIComponent(entry.id)}`}>
              <PenLine className="mr-1.5 h-4 w-4" /> Compor com esta análise
            </Link>
          </Button>
        </div>
      </div>

      <AnalysisReport
        analysisMd={entry.analysis_md}
        analysis={entry.analysis}
        organico={analiseOrganica(entry.ads)}
      />

      <AnunciosSalvos ads={entry.ads} entryId={entry.id} especialidade={entry.especialidades[0]} />
    </div>
  );
}

/**
 * Os anúncios de uma análise salva, com as perguntas que foram feitas ao grid na Mineração.
 *
 * As perguntas vêm DENTRO de cada anúncio (o snapshot guarda só os selecionados), então ordenar por
 * uma delas aqui é ordenar entre os analisados. O #n não muda com a ordem: ele é a posição em que o
 * agente leu a peça, e é por ele que o texto da análise a cita.
 */
function AnunciosSalvos({
  ads,
  entryId,
  especialidade,
}: {
  ads: SpyAd[];
  entryId: string;
  especialidade?: string;
}) {
  const perguntas = useMemo(() => perguntasSalvas(ads), [ads]);
  const [texto, setTexto] = useState<string | null>(null);
  const question = useMemo(() => (texto ? perguntaSalva(ads, texto) : null), [ads, texto]);
  const citacao = useMemo(() => new Map(ads.map((ad, i) => [ad.id, i + 1])), [ads]);
  const ordenados = useMemo(() => ordenarPorResposta(ads, question), [ads, question]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Anúncios analisados ({ads.length})</h3>

      {perguntas.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ordenar por pergunta">
            <span className="text-xs text-muted-foreground">Ordenar por pergunta:</span>
            {[null, ...perguntas].map((p) => (
              <button
                key={p ?? "analise"}
                type="button"
                title={p ?? undefined}
                aria-pressed={texto === p}
                onClick={() => setTexto(p)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  texto === p
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {p === null ? "Ordem da análise" : rotuloDaPergunta(p)}
              </button>
            ))}
          </div>
          {texto && <p className="text-xs text-muted-foreground">“{texto}”</p>}
        </div>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ordenados.map((ad) => (
          <AdCard
            key={ad.id}
            ad={ad}
            selected={false}
            citeIndex={citacao.get(ad.id)}
            resposta={question ? respostaDe(question, ad) : undefined}
            origemCriativo={{ libraryEntryId: entryId }}
            especialidadeCriativo={especialidade}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Biblioteca de Análises — análises salvas da Mineração, compartilhadas com toda a equipe interna.
 *
 * A análise aberta fica na URL (`?analise=<id>`), para dar para mandar o link a alguém da equipe.
 * Apagar é só de quem salvou ou de admin; o worker impõe isso, e o botão só aparece quando pode.
 */
export default function MarketingBiblioteca() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("analise");
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);

  const { especialidadeOptions, loading: espLoading } = useEspecialidades();
  const { entries, isLoading, error } = useLibrary(especialidades);
  const del = useDeleteLibraryEntry();
  const favorite = useToggleFavorite();
  const { itens: avaliacoes } = useAvaliacoes("analise");

  const options = useMemo(() => especialidadeOptions.map((e) => ({ id: e, label: e })), [especialidadeOptions]);

  const visiveis = useMemo(
    () => filtrarAnalises(entries, { busca, soFavoritos }),
    [entries, busca, soFavoritos],
  );

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("analise", id);
    else next.delete("analise");
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    del.mutate(target.id, {
      onSuccess: () => {
        toast.success("Análise apagada");
        if (openId === target.id) open(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível apagar"),
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <MineracaoHeader activeTab="Mineração" />
        <MineracaoSubnav activeTab="Minerações Salvas" />

        {openId ? (
          <EntryDetail
            id={openId}
            onBack={() => open(null)}
            onDelete={() => setPendingDelete({ id: openId, label: "esta análise" })}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <MetasMultiSelect
                title="Especialidades"
                options={options}
                selected={especialidades}
                onChange={setEspecialidades}
                placeholder={espLoading ? "Carregando…" : "Todas as especialidades"}
                pluralNoun="especialidades"
                disabled={espLoading}
                searchable
              />

              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou tema"
                  aria-label="Buscar análise por nome"
                  className="h-9 pl-8 text-xs"
                />
              </div>

              <Button
                type="button"
                variant={soFavoritos ? "default" : "outline"}
                size="sm"
                aria-pressed={soFavoritos}
                onClick={() => setSoFavoritos((v) => !v)}
                className="h-9"
              >
                <Star className={`mr-1.5 h-3.5 w-3.5 ${soFavoritos ? "fill-current" : ""}`} />
                Favoritos
              </Button>

              {!isLoading && (
                <span className="text-xs text-muted-foreground">
                  {visiveis.length} análise{visiveis.length === 1 ? "" : "s"}
                  {visiveis.length !== entries.length && ` de ${entries.length}`}
                </span>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-72 rounded-xl" />
                ))}
              </div>
            ) : visiveis.length === 0 ? (
              <div className="neu-card rounded-xl p-10 text-center text-sm text-muted-foreground">
                {busca.trim() || soFavoritos
                  ? // Filtro em memória: a lista existe, só não casou. Dizer isso evita a leitura
                    // de que a Biblioteca está vazia.
                    "Nenhuma análise com esses filtros."
                  : especialidades.length
                    ? "Nenhuma análise salva para essas especialidades."
                    : "Nenhuma análise salva ainda. Analise anúncios na aba Mineração e use “Salvar na Biblioteca”."}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visiveis.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    onOpen={() => open(entry.id)}
                    onDelete={() => setPendingDelete({ id: entry.id, label: `“${entry.titulo || entry.tema}”` })}
                    avaliacao={avaliacoes[entry.id]}
                    onToggleFavorite={() =>
                      favorite.mutate(
                        { id: entry.id, favorito: !entry.favorito },
                        {
                          onError: (err) =>
                            toast.error(
                              err instanceof Error ? err.message : "Não foi possível favoritar",
                            ),
                        },
                      )
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}

        <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
          <AlertDialogContent className="neu-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar da Biblioteca?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDelete?.label} some para toda a equipe. Não dá para desfazer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Apagar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
