import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Calendar, Image as ImageIcon, Loader2, Microscope, Pencil, Search, Star, Trash2, User } from "lucide-react";
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
import { AdCard } from "@/components/marketing/mineracao/AdCard";
import { SourceBadge } from "@/components/marketing/mineracao/AdSourceBits";
import { filtrarCriativos, nomeDoCriativo } from "@/components/marketing/mineracao/criativoTexto";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";
import { DissecacaoCriativo } from "@/components/marketing/mineracao/DissecacaoCriativo";
import { MenuCopiarCriativo } from "@/components/marketing/mineracao/MenuCopiarCriativo";
import { PassosDoCriativo } from "@/components/marketing/mineracao/PassosDoCriativo";
import { AvaliacaoControles } from "@/components/marketing/AvaliacaoControles";
import { useEspecialidades } from "@/hooks/useEspecialidades";
import { useAvaliacoes } from "@/hooks/useAvaliacoes";
import {
  useAtualizarCriativo,
  useCriativo,
  useCriativos,
  useDeleteCriativo,
  useSpyMedia,
  useToggleCriativoFavorite,
} from "@/hooks/useAdSpy";
import {
  NIVEL_CONSCIENCIA_LABEL,
  type SpyAd,
  type SpyCriativo,
  type SpyCriativoResumo,
} from "@/lib/adSpyApi";
import type { AvaliacaoItem } from "@/lib/avaliacoesApi";

/** "Interno · <cliente>": a análise é de um anúncio do próprio cliente, não de um concorrente. */
function SeloInterno({ cliente }: { cliente?: string | null }) {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
      Interno{cliente ? ` · ${cliente}` : ""}
    </span>
  );
}

/** O criativo interno analisado: a miniatura, o nome, o texto do post e o link para o vídeo. */
function CriativoInternoResumo({
  ad,
}: {
  ad: SpyAd & { thumb_public_url?: string | null; nome_anuncio?: string | null };
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex aspect-[4/5] items-center justify-center overflow-hidden bg-muted">
        {ad.thumb_public_url ? (
          <img src={ad.thumb_public_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
        )}
      </div>
      <div className="space-y-1.5 p-3 text-xs">
        <p className="font-semibold">{ad.nome_anuncio || ad.title || "Criativo do cliente"}</p>
        {ad.title && <p className="text-muted-foreground">{ad.title}</p>}
        {ad.ad_copy && <p className="line-clamp-6 whitespace-pre-line text-foreground/90">{ad.ad_copy}</p>}
        {ad.permalink && (
          <a href={ad.permalink} target="_blank" rel="noopener noreferrer" className="inline-block font-medium text-primary hover:underline">
            Ver o vídeo no Facebook
          </a>
        )}
      </div>
    </article>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** "Analisando…", "Falhou" ou o nível de consciência: o que o card diz sobre o estado da análise. */
function EstadoChip({ c }: { c: Pick<SpyCriativoResumo, "status" | "etapa" | "dissecacao"> }) {
  if (c.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        {c.etapa ? `${c.etapa[0].toUpperCase()}${c.etapa.slice(1)}…` : "Analisando…"}
      </span>
    );
  }
  if (c.status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <AlertCircle className="h-3 w-3" />
        Falhou
      </span>
    );
  }
  const nivel = c.dissecacao?.nivel_consciencia ? NIVEL_CONSCIENCIA_LABEL[c.dissecacao.nivel_consciencia] : null;
  return nivel ? (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{nivel}</span>
  ) : null;
}

function CriativoCard({
  c,
  onOpen,
  onDelete,
  onToggleFavorite,
  avaliacao,
}: {
  c: SpyCriativoResumo;
  onOpen: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  avaliacao?: AvaliacaoItem;
}) {
  // Criativo interno não tem linha em `ad_spy_ads`: a miniatura é a pública da conta de anúncios.
  const daMineracao = useSpyMedia(c.ad?.id ?? 0, "thumb", Boolean(c.ad?.id && c.ad?.thumb_path));
  const thumb = c.ad?.thumb_public_url || daMineracao;
  const nome = nomeDoCriativo(c);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Fora do <button> que abre o item, pela mesma razão da Biblioteca: botão dentro de botão
          não é HTML válido, e clicar na estrela não pode abrir a análise. */}
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={c.favorito}
        aria-label={c.favorito ? `Remover "${nome}" dos favoritos` : `Favoritar "${nome}"`}
        className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1.5 backdrop-blur transition-colors hover:bg-background"
      >
        <Star className={`h-4 w-4 ${c.favorito ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} />
      </button>
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        <div className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-muted">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-2 text-sm font-semibold">{nome}</h3>
          {c.origem === "cliente" && <SeloInterno cliente={c.cliente} />}
          <div className="flex flex-wrap items-center gap-1">
            {c.especialidades.map((e) => (
              <span key={e} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {e}
              </span>
            ))}
            <EstadoChip c={c} />
          </div>
          {c.dissecacao?.blocos?.length ? (
            // Versão 2: a estrutura simplificada em sequência — a peça se lê de relance.
            <ol className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground" aria-label="Estrutura">
              {c.dissecacao.blocos.map((b, i) => (
                <li key={b.n} className="inline-flex items-center gap-1">
                  {i > 0 && <span aria-hidden>→</span>}
                  <span className="rounded-md bg-muted px-1.5 py-0.5">{b.nome}</span>
                </li>
              ))}
            </ol>
          ) : (
            c.dissecacao?.estrutura && (
              <p className="line-clamp-3 text-xs text-muted-foreground">{c.dissecacao.estrutura}</p>
            )
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {c.saved_by_name || "—"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(c.criado_em)}
            </span>
          </div>
        </div>
      </button>
      <div className="border-t border-border px-3 py-1.5">
        <AvaliacaoControles alvo="criativo" id={c.id} avaliacao={avaliacao} compacto />
      </div>
      {c.canDelete && (
        <div className="flex justify-end border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Apagar análise "${nome}"`}
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

/**
 * O nome da análise, editável por quem a pediu (ou admin — o `canDelete`, o mesmo critério do worker).
 * O nome padrão é o anunciante e a data; quem tem várias análises do mesmo anunciante precisa dar
 * um nome que diga qual é qual, e só dava na hora de pedir.
 */
function NomeDoCriativo({ id, nome, podeEditar }: { id: string; nome: string; podeEditar: boolean }) {
  const atualizar = useAtualizarCriativo();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(nome);
  const salvar = () => {
    const novo = valor.trim();
    if (!novo || novo === nome) {
      setEditando(false);
      return;
    }
    atualizar.mutate(
      { id, titulo: novo },
      {
        onSuccess: () => {
          setEditando(false);
          toast.success("Nome atualizado.");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível renomear"),
      },
    );
  };
  if (!editando) {
    return (
      <div className="flex items-center gap-1.5">
        <h2 className="text-lg font-semibold">{nome}</h2>
        {podeEditar && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Renomear a análise"
            onClick={() => {
              setValor(nome);
              setEditando(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditando(false)}
        maxLength={200}
        autoFocus
        aria-label="Nome da análise"
        className="h-9 w-80 max-w-full text-sm"
      />
      <Button type="submit" size="sm" disabled={!valor.trim() || atualizar.isPending}>
        {atualizar.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Salvar
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(false)} disabled={atualizar.isPending}>
        Cancelar
      </Button>
    </form>
  );
}

function CriativoDetalhe({ id, onBack, onDelete }: { id: string; onBack: () => void; onDelete: () => void }) {
  const { criativo, isLoading, error } = useCriativo(id);
  const { itens: avaliacoes } = useAvaliacoes("criativo");
  const favorite = useToggleCriativoFavorite();

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !criativo) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Voltar
        </Button>
        <p className="text-sm text-destructive">{error || "Análise de criativo não encontrada."}</p>
      </div>
    );
  }
  const nome = nomeDoCriativo(criativo);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Análises de Criativos
          </Button>
          <NomeDoCriativo id={criativo.id} nome={nome} podeEditar={criativo.canDelete} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {criativo.especialidades.map((e) => (
              <span key={e} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {e}
              </span>
            ))}
            {criativo.origem === "cliente" ? (
              <SeloInterno cliente={criativo.cliente} />
            ) : (
              criativo.ad && <SourceBadge ad={criativo.ad} />
            )}
            <span>
              · pedida por {criativo.saved_by_name || "—"} em {formatDate(criativo.criado_em)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={criativo.favorito}
            onClick={() =>
              favorite.mutate(
                { id: criativo.id, favorito: !criativo.favorito },
                { onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível favoritar") },
              )
            }
          >
            <Star className={`mr-1.5 h-4 w-4 ${criativo.favorito ? "fill-amber-400 text-amber-500" : ""}`} />
            {criativo.favorito ? "Favorito" : "Favoritar"}
          </Button>
          <AvaliacaoControles alvo="criativo" id={criativo.id} avaliacao={avaliacoes[criativo.id]} />
          <MenuCopiarCriativo criativo={criativo} />
          {criativo.canDelete && criativo.status !== "running" && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Apagar
            </Button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        {criativo.origem === "cliente" ? (
          <CriativoInternoResumo ad={criativo.ad as SpyAd & { thumb_public_url?: string | null; nome_anuncio?: string | null }} />
        ) : criativo.ad ? (
          <AdCard ad={criativo.ad as SpyAd} selected={false} />
        ) : (
          <div />
        )}

        <div className="neu-card space-y-4 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <Microscope className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Dissecação</h3>
          </div>
          {criativo.status === "running" ? (
            <PassosDoCriativo etapa={criativo.etapa} desde={criativo.atualizado_em} interno={criativo.origem === "cliente"} />
          ) : criativo.status === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {criativo.error || "A análise falhou."} Peça de novo pelo “Analisar Criativo” do anúncio.
            </p>
          ) : (
            <DissecacaoCriativo criativo={criativo} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mineração › Análises de Criativos — a dissecação de UM anúncio, pedida pelo "Analisar Criativo"
 * de dentro dele, salva por especialidade e compartilhada com a equipe.
 *
 * Mesmos controles das Minerações Salvas — especialidade, nome, favoritos, voto e tag — porque é o
 * mesmo tipo de prateleira: quem já sabe achar uma mineração salva sabe achar um criativo.
 * A análise aberta fica na URL (`?criativo=<id>`), para dar para mandar o link.
 */
export default function MarketingCriativos() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("criativo");
  const [especialidades, setEspecialidades] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [soFavoritos, setSoFavoritos] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);

  const { especialidadeOptions, loading: espLoading } = useEspecialidades();
  const { criativos, isLoading, error } = useCriativos(especialidades);
  const del = useDeleteCriativo();
  const favorite = useToggleCriativoFavorite();
  const { itens: avaliacoes } = useAvaliacoes("criativo");

  const options = useMemo(() => especialidadeOptions.map((e) => ({ id: e, label: e })), [especialidadeOptions]);
  const visiveis = useMemo(() => filtrarCriativos(criativos, { busca, soFavoritos }), [criativos, busca, soFavoritos]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("criativo", id);
    else next.delete("criativo");
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const confirmDelete = () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    del.mutate(target.id, {
      onSuccess: () => {
        toast.success("Análise de criativo apagada");
        if (openId === target.id) open(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível apagar"),
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <MineracaoHeader activeTab="Mineração" />
        <MineracaoSubnav activeTab="Análises de Criativos" />

        {openId ? (
          <CriativoDetalhe
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
                  placeholder="Buscar por nome ou anunciante"
                  aria-label="Buscar análise de criativo por nome"
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
                  {visiveis.length !== criativos.length && ` de ${criativos.length}`}
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
                  ? "Nenhuma análise de criativo com esses filtros."
                  : especialidades.length
                    ? "Nenhuma análise de criativo para essas especialidades."
                    : "Nenhuma análise de criativo ainda. Abra um anúncio na Nova Mineração ou em Minerações Salvas e use “Analisar Criativo”."}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visiveis.map((c) => (
                  <CriativoCard
                    key={c.id}
                    c={c}
                    onOpen={() => open(c.id)}
                    onDelete={() => setPendingDelete({ id: c.id, label: `“${nomeDoCriativo(c)}”` })}
                    avaliacao={avaliacoes[c.id]}
                    onToggleFavorite={() =>
                      favorite.mutate(
                        { id: c.id, favorito: !c.favorito },
                        { onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível favoritar") },
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
              <AlertDialogTitle>Apagar a análise de criativo?</AlertDialogTitle>
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
