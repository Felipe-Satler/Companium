import { useMemo } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MineracaoHeader } from "@/components/marketing/mineracao/MineracaoHeader";
import { EtapasComposer } from "@/components/marketing/composer/EtapasComposer";
import { OficinaSubnav } from "@/components/marketing/oficina/OficinaSubnav";
import { ArteDoAnuncio, AvisoSemCrm } from "@/components/marketing/oficina/ArteDoAnuncio";
import { anunciosParaArte, composicoesComArte } from "@/components/marketing/oficina/anuncios";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useComposition, useCompositions } from "@/hooks/useAdComposer";
import { useArtesSalvas } from "@/hooks/useArtes";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useClientesVisiveis } from "@/hooks/useClientesVisiveis";
import { useProjetosLista } from "@/hooks/useProjetosLista";
import { anunciosDe } from "@/lib/adComposerApi";
import { getFormato } from "../../shared/ad-formats";
import { kitTemElemento } from "../../shared/brand-kit";

/**
 * Oficina de Artes › Nova arte: onde um anúncio aprovado vira a arte que vai ser postada.
 *
 * Três etapas, no mesmo cabeçalho do Composer (`EtapasComposer`), cada uma mostrando o que ficou
 * decidido nela:
 *
 *   1. CLIENTE  — a carteira ativa. O Brand kit é conferido aqui, e não no fim: sem nome, CRM e UF
 *                 não há arte, e descobrir isso depois de escolher o anúncio seria trabalho perdido.
 *   2. ANÚNCIO  — as composições SALVAS do cliente, com todos os anúncios. Os que não viram arte
 *                 (vídeo, Google Ads) aparecem desabilitados, com o motivo: sumir com eles faria a
 *                 composição parecer incompleta.
 *   3. ARTE     — a pré-etapa (o que entra na arte), e depois o preview, o ajuste e o download.
 *
 * O estado mora na URL (`?cliente=&composicao=&anuncio=&arte=`): o "Abrir na Oficina" do Composer e o
 * "Outras artes deste anúncio" das Artes Salvas chegam direto na etapa 3, e um F5 não perde nada.
 */

type EtapaId = "cliente" | "anuncio" | "arte";

function data(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MarketingOficina() {
  // Arma o filtro de ativos/ocultos. Sem isso `index.ativos` não sabe quem está ativo.
  useClientesVisiveis();
  const [params, setParams] = useSearchParams();
  const { index, loading: projetosLoading } = useProjetosLista();

  const composicaoId = params.get("composicao");
  const indiceParam = params.get("anuncio");
  const indice = indiceParam != null && indiceParam !== "" ? Number(indiceParam) : null;
  const arteId = params.get("arte");

  const { composition, isLoading: composicaoCarregando, error: composicaoErro } = useComposition(composicaoId);
  // Chegando direto num anúncio (link do Composer), o cliente vem da composição.
  const cliente = params.get("cliente") || composition?.cliente || "";

  const etapa: EtapaId = composicaoId && indice != null ? "arte" : cliente ? "anuncio" : "cliente";

  const { data: kitResposta, isLoading: kitCarregando } = useBrandKit(cliente || null);
  const kitOk = Boolean(kitResposta?.kit && kitTemElemento(kitResposta.kit, "identificacao"));
  const { compositions, isLoading: composicoesCarregando } = useCompositions(cliente || null);
  const { data: artes } = useArtesSalvas();

  const clientes = useMemo(() => index.ativos.map((a) => ({ value: a.padrao, label: a.nome })), [index]);
  const nomeCliente = index.ativos.find((a) => a.padrao === cliente)?.nome ?? composition?.nome_exibicao ?? cliente;

  const salvas = useMemo(() => composicoesComArte(compositions), [compositions]);
  /** Quantas artes cada anúncio já tem — "c1#0" -> 2. */
  const artesPorAnuncio = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of artes ?? []) {
      if (!a.composition_id) continue;
      const k = `${a.composition_id}#${a.anuncio_indice}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [artes]);

  const anuncio = composition && indice != null ? anunciosDe(composition)[indice] : null;

  const ir = (proximo: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(proximo)) {
        if (v == null) n.delete(k);
        else n.set(k, v);
      }
      return n;
    });

  const etapas = [
    { id: "cliente", label: "Cliente", resumo: cliente ? nomeCliente : null },
    {
      id: "anuncio",
      label: "Anúncio",
      resumo: anuncio ? `${getFormato(anuncio.formato ?? "")?.label ?? anuncio.formato} · anúncio ${indice! + 1}` : null,
    },
    { id: "arte", label: "Arte", resumo: arteId ? "aberta" : null },
  ];

  const irParaEtapa = (id: string) => {
    if (id === "cliente") ir({ cliente: null, composicao: null, anuncio: null, arte: null });
    if (id === "anuncio") ir({ cliente, composicao: null, anuncio: null, arte: null });
  };

  let corpo: JSX.Element;
  if (etapa === "cliente") {
    corpo = (
      <div className="max-w-md space-y-2">
        <p className="text-sm text-muted-foreground">De qual cliente é a arte?</p>
        <SearchableSelect
          options={clientes}
          value={cliente}
          onValueChange={(v) => ir({ cliente: v || null, composicao: null, anuncio: null, arte: null })}
          placeholder={projetosLoading ? "Carregando a carteira…" : "Escolha o cliente"}
          searchPlaceholder="Buscar cliente"
          triggerClassName="h-9 w-full text-xs"
        />
      </div>
    );
  } else if (etapa === "anuncio") {
    corpo = (
      <div className="space-y-4">
        {!kitCarregando && !kitOk && <AvisoSemCrm />}
        {composicoesCarregando ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> carregando as composições…
          </p>
        ) : salvas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {nomeCliente} não tem composição salva com anúncio de Feed ou de Meta Ads. Componha e salve uma no Composer.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Escolha o anúncio. Só composições salvas aparecem aqui.</p>
            {salvas.map((c) => (
              <div key={c.id} className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-2">
                  <p className="text-xs font-semibold">Composição de {data(c.criado_em)}</p>
                  {c.analise_titulo && <p className="text-[11px] text-muted-foreground">análise “{c.analise_titulo}”</p>}
                </div>
                <ul className="divide-y divide-border">
                  {anunciosParaArte(c).map((a) => {
                    const feitas = artesPorAnuncio.get(`${c.id}#${a.indice}`) ?? 0;
                    return (
                      <li key={a.indice}>
                        <button
                          type="button"
                          disabled={!a.elegivel || !kitOk}
                          onClick={() => ir({ cliente, composicao: c.id, anuncio: String(a.indice), arte: null })}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{a.indice + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold">{a.rotulo}</span>
                            {a.angulo && <span className="block truncate text-[11px] text-muted-foreground">{a.angulo}</span>}
                            {a.motivo && <span className="block text-[11px] text-muted-foreground">{a.motivo}</span>}
                          </span>
                          {a.elegivel && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {feitas ? `${feitas} arte${feitas === 1 ? "" : "s"}` : "nenhuma arte"}
                            </span>
                          )}
                          {a.elegivel && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else if (composicaoCarregando) {
    corpo = (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> carregando…
      </p>
    );
  } else if (composicaoErro || !composition) {
    corpo = <p className="text-sm text-destructive">{composicaoErro || "Composição não encontrada."}</p>;
  } else {
    corpo = (
      <div className="space-y-4">
        {anuncio && (
          <p className="text-xs text-muted-foreground">
            {getFormato(anuncio.formato ?? "")?.label ?? anuncio.formato}
            {anuncio.angulo ? ` · ${anuncio.angulo}` : ""}
          </p>
        )}
        <ArteDoAnuncio
          composicao={composition}
          indice={indice!}
          arteId={arteId}
          onArte={(id, opcoes) =>
            setParams(
              (p) => {
                const n = new URLSearchParams(p);
                n.set("arte", id);
                if (!n.get("cliente")) n.set("cliente", composition.cliente);
                return n;
              },
              { replace: Boolean(opcoes?.substituir) }
            )
          }
        />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <MineracaoHeader activeTab="Oficina de Artes" />
        <OficinaSubnav activeTab="Nova arte" />
        <EtapasComposer etapas={etapas} atual={etapa} onIr={irParaEtapa} />
        {corpo}
      </div>
    </DashboardLayout>
  );
}

/**
 * O endereço antigo da arte (`/marketing/composer/estatico`, de antes da Oficina). Links guardados e
 * o histórico do navegador continuam chegando: vão para a Nova arte, com os mesmos parâmetros.
 */
export function RedirecionarEstatico() {
  const { search } = useLocation();
  return <Navigate to={`/marketing/oficina${search}`} replace />;
}
