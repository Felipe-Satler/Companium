import { AlertTriangle, ImagePlus, Loader2, Lock, LockOpen, Plus, RefreshCw, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBrandKit, useImagemAutenticada } from "@/hooks/useBrandKit";
import {
  ErroDoKit,
  enviarImagemDoKit,
  removerImagemDoKit,
  salvarBrandKit,
  urlDaImagemDoKit,
  type IdentificacaoDoEstudo,
} from "@/lib/brandKitApi";
import { carregarFonte } from "@/posts/fontes";
import {
  FONTES,
  IMAGENS_DO_KIT,
  MAX_BYTES_IMAGEM,
  MAX_ENDERECOS,
  MIMES_DE_IMAGEM,
  UFS,
  type BrandKit,
  type ImagemDoKitId,
} from "../../../../shared/brand-kit";
import {
  PAPEIS_DA_PALETA,
  avisosDaPaleta,
  gerarPaleta,
  normalizarHex,
  textoSobre,
  type PaletaGerada,
  type PapelDaPaleta,
} from "../../../../shared/paleta";

/**
 * A aba Brand kit: o que uma arte estática deste cliente PODE usar.
 *
 * Se cada elemento entra numa arte é decisão da criação do estático (as chaves "incluir / não
 * incluir"), então aqui nada é obrigatório — um kit só com o logo já serve para alguma coisa.
 *
 * ## A paleta fixa e a gerada ficam em linhas separadas
 *
 * A FIXA é a do cliente, a que as artes usam. A GERADA é uma sugestão: aparece embaixo, dá para gerar
 * quantas quiser, e só vira a fixa num clique explícito — que pede confirmação, porque a paleta de um
 * cliente que já tem artes publicadas não é coisa de se trocar sem querer. Gerar em volta de uma cor
 * da fixa é o cadeado de cada cor.
 *
 * O gerador é local (`shared/paleta.js`): as APIs de paleta que existem são só para uso não comercial.
 */

const ROTULO_DO_PAPEL: Record<PapelDaPaleta, string> = {
  primaria: "Primária",
  secundaria: "Secundária",
  terciaria: "Terciária",
};

const AJUDA_DO_PAPEL: Record<PapelDaPaleta, string> = {
  primaria: "A cor forte: fundo da capa, títulos.",
  secundaria: "O acento: destaques e o botão de chamada.",
  terciaria: "O fundo claro, onde vai o texto corrido.",
};

function data(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** "12345/RS", "CRM-RS 12345" -> { crm: "12345", uf: "RS" }. É o que o Estudo costuma trazer. */
function crmDoEstudo(bruto: string | null | undefined) {
  const s = String(bruto ?? "").toUpperCase();
  const uf = UFS.find((u) => new RegExp(`(^|[^A-Z])${u}([^A-Z]|$)`).test(s)) ?? "";
  return { crm: s.replace(/\D/g, ""), uf };
}

function Amostra({ cor, rotulo, pequena = false }: { cor: string | null; rotulo?: string; pequena?: boolean }) {
  return (
    <div
      className={`flex items-end rounded-md border border-border ${pequena ? "h-10" : "h-14"} w-full p-1.5`}
      style={{ background: cor ?? "transparent" }}
    >
      {cor ? (
        <span className="text-[10px] font-semibold tabular-nums" style={{ color: textoSobre(cor) }}>
          {rotulo ?? cor}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">sem cor</span>
      )}
    </div>
  );
}

function AvisosDeContraste({ paleta }: { paleta: Partial<Record<PapelDaPaleta, string | null>> }) {
  const avisos = avisosDaPaleta(paleta as never);
  if (!avisos.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {avisos.map((a) => (
        <li key={a.par} className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {a.detalhe} (contraste {a.contraste.toLocaleString("pt-BR")}:1; o mínimo é 4,5:1)
        </li>
      ))}
    </ul>
  );
}

function Campo({
  id,
  label,
  erro,
  children,
  ajuda,
}: {
  id: string;
  label: string;
  erro?: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {ajuda && !erro && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
      {erro && <p className="text-[11px] text-destructive">{erro}</p>}
    </div>
  );
}

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
        {acao}
      </div>
      {children}
    </section>
  );
}

function ImagemDoKit({
  cliente,
  tipo,
  label,
  ajuda,
  caminho,
  token,
  onTrocar,
}: {
  cliente: string;
  tipo: ImagemDoKitId;
  label: string;
  ajuda: string;
  caminho: string | null;
  token: string;
  onTrocar: (imagens: BrandKit["imagens"]) => void;
}) {
  const url = useImagemAutenticada(caminho ? urlDaImagemDoKit(cliente, tipo) : null, token, caminho);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    if (!MIMES_DE_IMAGEM.includes(arquivo.type)) {
      toast.error("Envie uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (arquivo.size > MAX_BYTES_IMAGEM) {
      toast.error(`A imagem passa de ${Math.round(MAX_BYTES_IMAGEM / 1024 / 1024)} MB.`);
      return;
    }
    setEnviando(true);
    try {
      const { imagens } = await enviarImagemDoKit(token, cliente, tipo, arquivo);
      onTrocar(imagens);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const remover = async () => {
    setEnviando(true);
    try {
      const { imagens } = await removerImagemDoKit(token, cliente, tipo);
      onTrocar(imagens);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível remover a imagem.");
    } finally {
      setEnviando(false);
    }
  };

  // O logo para fundo escuro é mostrado sobre fundo escuro: sobre o branco ele some.
  const fundo = tipo === "logo_escuro" ? "bg-neutral-800" : "bg-muted/40";
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      <div className={`flex h-24 items-center justify-center overflow-hidden rounded-md border border-border ${fundo}`}>
        {enviando ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : url ? (
          <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[11px] text-muted-foreground">{caminho ? "carregando…" : "nenhuma"}</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{ajuda}</p>
      <div className="flex gap-1.5">
        <input
          ref={entrada}
          type="file"
          accept={MIMES_DE_IMAGEM.join(",")}
          className="hidden"
          onChange={(e) => enviar(e.target.files?.[0])}
          aria-label={`Enviar ${label}`}
        />
        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={enviando} onClick={() => entrada.current?.click()}>
          <ImagePlus className="mr-1 h-3 w-3" />
          {caminho ? "Trocar" : "Enviar"}
        </Button>
        {caminho && (
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={enviando} onClick={remover}>
            <Trash2 className="mr-1 h-3 w-3" />
            Remover
          </Button>
        )}
      </div>
    </div>
  );
}

export function BrandKitTab({ cliente }: { cliente: string }) {
  const { data: resposta, isLoading, error, token, gravar, refetch } = useBrandKit(cliente);
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [gerada, setGerada] = useState<PaletaGerada | null>(null);
  const [travadas, setTravadas] = useState<Record<PapelDaPaleta, boolean>>({
    primaria: false,
    secundaria: false,
    terciaria: false,
  });
  const [confirmando, setConfirmando] = useState(false);

  // O formulário parte do que veio do worker, e só é reposto quando NÃO há edição pendente — senão
  // um refetch em segundo plano apagaria o que a pessoa está digitando.
  useEffect(() => {
    if (resposta?.kit && !sujo) setKit(resposta.kit);
  }, [resposta, sujo]);

  useEffect(() => {
    if (kit?.fontes.titulo) void carregarFonte(kit.fontes.titulo);
    if (kit?.fontes.texto) void carregarFonte(kit.fontes.texto);
  }, [kit?.fontes.titulo, kit?.fontes.texto]);

  const editar = (muda: (k: BrandKit) => BrandKit) => {
    setKit((k) => (k ? muda(k) : k));
    setSujo(true);
  };

  const salvar = async (proximo: BrandKit | null = kit) => {
    if (!proximo) return;
    setSalvando(true);
    setErros({});
    try {
      const salvo = await salvarBrandKit(token, cliente, proximo);
      gravar(salvo);
      setKit(salvo.kit);
      setSujo(false);
      toast.success("Brand kit salvo.");
    } catch (err) {
      if (err instanceof ErroDoKit) {
        setErros(Object.fromEntries(err.erros.map((e) => [e.campo, e.detalhe])));
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Não foi possível salvar o Brand kit.");
      }
    } finally {
      setSalvando(false);
    }
  };

  const gerar = () => {
    if (!kit) return;
    const fixas = Object.fromEntries(
      PAPEIS_DA_PALETA.filter((p) => travadas[p] && kit.paleta[p]).map((p) => [p, kit.paleta[p]])
    );
    setGerada(gerarPaleta({ travadas: fixas }));
  };

  /** Substitui a fixa pela gerada e grava — depois da confirmação. */
  const usarGerada = async () => {
    if (!kit || !gerada) return;
    const proximo = {
      ...kit,
      paleta: { primaria: gerada.primaria, secundaria: gerada.secundaria, terciaria: gerada.terciaria },
    };
    setKit(proximo);
    setConfirmando(false);
    await salvar(proximo);
  };

  const temPaletaFixa = Boolean(kit && PAPEIS_DA_PALETA.some((p) => kit.paleta[p]));
  const estudo: IdentificacaoDoEstudo = resposta?.identificacaoDoEstudo ?? null;
  const sugestaoDoEstudo = useMemo(() => {
    if (!estudo) return null;
    const { crm, uf } = crmDoEstudo(estudo.crm);
    return { nome: estudo.nome || "", crm, uf, rqe: estudo.rqe || "" };
  }, [estudo]);

  if (isLoading || (!kit && !error)) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> carregando o Brand kit…
      </p>
    );
  }
  if (error || !kit) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "Não foi possível carregar o Brand kit."}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Tentar de novo
        </Button>
      </div>
    );
  }

  const id = kit.identificacao;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        O que as artes estáticas deste cliente podem usar. Se cada elemento entra numa arte, você decide ao
        criar o estático.
        {resposta?.atualizado_em && <> Atualizado em {data(resposta.atualizado_em)}.</>}
      </p>

      <Secao titulo="Paleta">
        <div className="space-y-1">
          <p className="text-xs font-medium">Paleta fixa</p>
          <div className="grid grid-cols-3 gap-2">
            {PAPEIS_DA_PALETA.map((papel) => {
              const cor = kit.paleta[papel];
              return (
                <div key={papel} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium">{ROTULO_DO_PAPEL[papel]}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                      disabled={!cor}
                      onClick={() => setTravadas((t) => ({ ...t, [papel]: !t[papel] }))}
                      title={travadas[papel] ? "Manter esta cor ao gerar: sim" : "Manter esta cor ao gerar: não"}
                      aria-label={`Manter a ${ROTULO_DO_PAPEL[papel].toLowerCase()} ao gerar`}
                      aria-pressed={travadas[papel]}
                    >
                      {travadas[papel] && cor ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                    </button>
                  </div>
                  <Amostra cor={cor} />
                  <div className="flex gap-1">
                    <input
                      type="color"
                      value={normalizarHex(cor) ?? "#FFFFFF"}
                      onChange={(e) => editar((k) => ({ ...k, paleta: { ...k.paleta, [papel]: normalizarHex(e.target.value) } }))}
                      className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                      aria-label={`Escolher a ${ROTULO_DO_PAPEL[papel].toLowerCase()}`}
                    />
                    <Input
                      value={cor ?? ""}
                      placeholder="#RRGGBB"
                      onChange={(e) =>
                        editar((k) => ({
                          ...k,
                          paleta: { ...k.paleta, [papel]: normalizarHex(e.target.value) ?? (e.target.value || null) },
                        }))
                      }
                      className="h-7 px-2 font-mono text-[11px]"
                      aria-label={`Código da ${ROTULO_DO_PAPEL[papel].toLowerCase()}`}
                    />
                  </div>
                  {erros[`paleta.${papel}`] ? (
                    <p className="text-[11px] text-destructive">{erros[`paleta.${papel}`]}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{AJUDA_DO_PAPEL[papel]}</p>
                  )}
                </div>
              );
            })}
          </div>
          <AvisosDeContraste paleta={kit.paleta} />
        </div>

        <div className="space-y-1 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Paleta gerada</p>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={gerar}>
                <Wand2 className="mr-1 h-3 w-3" />
                Gerar paleta nova
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={!gerada || salvando}
                onClick={() => (temPaletaFixa ? setConfirmando(true) : void usarGerada())}
              >
                Usar esta
              </Button>
            </div>
          </div>
          {gerada ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {PAPEIS_DA_PALETA.map((papel) => (
                  <Amostra key={papel} cor={gerada[papel]} pequena />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Harmonia {gerada.harmonia}
                {PAPEIS_DA_PALETA.some((p) => travadas[p] && kit.paleta[p]) && ", em volta das cores com cadeado"}.
              </p>
              <AvisosDeContraste paleta={gerada} />
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Gere uma sugestão. Ela só substitui a paleta fixa quando você clicar em "Usar esta". Para manter uma
              cor da fixa, clique no cadeado dela antes de gerar.
            </p>
          )}
        </div>
      </Secao>

      <Secao titulo="Fontes">
        <div className="grid gap-3 sm:grid-cols-2">
          {(["titulo", "texto"] as const).map((papel) => (
            <Campo key={papel} id={`fonte-${papel}`} label={papel === "titulo" ? "Títulos" : "Texto"} erro={erros[`fontes.${papel}`]}>
              <Select value={kit.fontes[papel]} onValueChange={(v) => editar((k) => ({ ...k, fontes: { ...k.fontes, [papel]: v } }))}>
                <SelectTrigger id={`fonte-${papel}`} className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONTES.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      {f.id} <span className="text-muted-foreground">· {f.categoria}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                className="truncate pt-1"
                style={{
                  fontFamily: `"${kit.fontes[papel]}", sans-serif`,
                  fontSize: papel === "titulo" ? 20 : 14,
                  fontWeight: papel === "titulo" ? 700 : 400,
                }}
              >
                {papel === "titulo" ? "Seu ronco tem nome" : "Uma conversa sincera sobre o sono."}
              </p>
            </Campo>
          ))}
        </div>
      </Secao>

      <Secao titulo="Logo e fotos">
        <Campo id="nome-clinica" label="Nome da clínica" erro={erros.nome_clinica}>
          <Input
            id="nome-clinica"
            value={kit.nome_clinica}
            onChange={(e) => editar((k) => ({ ...k, nome_clinica: e.target.value }))}
            className="h-8 text-xs"
          />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          {IMAGENS_DO_KIT.map((img) => (
            <ImagemDoKit
              key={img.id}
              cliente={cliente}
              tipo={img.id}
              label={img.label}
              ajuda={img.ajuda}
              caminho={kit.imagens[img.id]}
              token={token}
              onTrocar={(imagens) => {
                // Imagem não espera o "Salvar": o upload já gravou. Atualiza os dois lados.
                setKit((k) => (k ? { ...k, imagens } : k));
                if (resposta) gravar({ kit: { ...resposta.kit, imagens } });
              }}
            />
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Médico"
        acao={
          sugestaoDoEstudo && (sugestaoDoEstudo.nome || sugestaoDoEstudo.crm) ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() =>
                editar((k) => ({
                  ...k,
                  identificacao: {
                    ...k.identificacao,
                    nome: sugestaoDoEstudo.nome || k.identificacao.nome,
                    crm: sugestaoDoEstudo.crm || k.identificacao.crm,
                    uf: sugestaoDoEstudo.uf || k.identificacao.uf,
                    rqe: sugestaoDoEstudo.rqe || k.identificacao.rqe,
                  },
                }))
              }
              title={`Do Estudo de Copy, lido na composição de ${data(estudo?.de)}`}
            >
              Preencher a partir do Estudo de Copy
            </Button>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <Campo id="medico-nome" label="Nome completo" erro={erros["identificacao.nome"]}>
              <Input
                id="medico-nome"
                value={id.nome}
                onChange={(e) => editar((k) => ({ ...k, identificacao: { ...k.identificacao, nome: e.target.value } }))}
                className="h-8 text-xs"
              />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo id="medico-crm" label="CRM" erro={erros["identificacao.crm"]}>
              <Input
                id="medico-crm"
                inputMode="numeric"
                value={id.crm}
                onChange={(e) => editar((k) => ({ ...k, identificacao: { ...k.identificacao, crm: e.target.value } }))}
                className="h-8 text-xs"
              />
            </Campo>
          </div>
          <div>
            <Campo id="medico-uf" label="UF" erro={erros["identificacao.uf"]}>
              <Select
                value={id.uf || ""}
                onValueChange={(v) => editar((k) => ({ ...k, identificacao: { ...k.identificacao, uf: v } }))}
              >
                <SelectTrigger id="medico-uf" className="h-8 text-xs">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {UFS.map((uf) => (
                    <SelectItem key={uf} value={uf} className="text-xs">
                      {uf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo id="medico-rqe" label="RQE" ajuda="Vazio quando o médico não tem." erro={erros["identificacao.rqe"]}>
              <Input
                id="medico-rqe"
                value={id.rqe}
                onChange={(e) => editar((k) => ({ ...k, identificacao: { ...k.identificacao, rqe: e.target.value } }))}
                className="h-8 text-xs"
              />
            </Campo>
          </div>
          {!id.rqe.trim() && (
            <div className="sm:col-span-4">
              <Campo
                id="medico-pos"
                label="Pós-graduação divulgada (sem RQE)"
                ajuda='Quando preenchida, toda arte que a citar sai com "NÃO ESPECIALISTA" (regra do CFM).'
                erro={erros["identificacao.pos_graduacao"]}
              >
                <Input
                  id="medico-pos"
                  value={id.pos_graduacao}
                  onChange={(e) =>
                    editar((k) => ({ ...k, identificacao: { ...k.identificacao, pos_graduacao: e.target.value } }))
                  }
                  className="h-8 text-xs"
                />
              </Campo>
            </div>
          )}
        </div>
        <label className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-xs">
          <Checkbox
            checked={kit.bio_conferida}
            onCheckedChange={(v) => editar((k) => ({ ...k, bio_conferida: v === true }))}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">A bio do Instagram está conforme o CFM</span>
            <span className="block text-muted-foreground">
              Nome completo, CRM com UF, a palavra "MÉDICO" e o RQE (se divulga especialidade). Com a bio conferida,
              o CRM fica opcional na arte de feed orgânico; sem ela, é obrigatório.
            </span>
          </span>
        </label>
      </Secao>

      <Secao titulo="Contato">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["whatsapp", "WhatsApp", "tel"],
              ["telefone", "Telefone", "tel"],
              ["instagram", "Instagram (@)", "text"],
              ["site", "Site", "url"],
              ["email", "E-mail", "email"],
            ] as const
          ).map(([campo, rotulo, tipo]) => (
            <Campo key={campo} id={`contato-${campo}`} label={rotulo} erro={erros[`contatos.${campo}`]}>
              <Input
                id={`contato-${campo}`}
                type={tipo}
                value={kit.contatos[campo]}
                onChange={(e) => editar((k) => ({ ...k, contatos: { ...k.contatos, [campo]: e.target.value } }))}
                className="h-8 text-xs"
              />
            </Campo>
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Endereços"
        acao={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            disabled={kit.enderecos.length >= MAX_ENDERECOS}
            onClick={() => editar((k) => ({ ...k, enderecos: [...k.enderecos, { rotulo: "", linha: "" }] }))}
          >
            <Plus className="mr-1 h-3 w-3" /> Adicionar
          </Button>
        }
      >
        {kit.enderecos.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum endereço.</p>}
        {kit.enderecos.map((e, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="w-32 shrink-0">
              <Campo id={`end-rotulo-${i}`} label="Unidade">
                <Input
                  id={`end-rotulo-${i}`}
                  value={e.rotulo}
                  placeholder="Centro"
                  onChange={(ev) =>
                    editar((k) => ({
                      ...k,
                      enderecos: k.enderecos.map((x, j) => (j === i ? { ...x, rotulo: ev.target.value } : x)),
                    }))
                  }
                  className="h-8 text-xs"
                />
              </Campo>
            </div>
            <div className="flex-1">
              <Campo id={`end-linha-${i}`} label="Endereço">
                <Input
                  id={`end-linha-${i}`}
                  value={e.linha}
                  onChange={(ev) =>
                    editar((k) => ({
                      ...k,
                      enderecos: k.enderecos.map((x, j) => (j === i ? { ...x, linha: ev.target.value } : x)),
                    }))
                  }
                  className="h-8 text-xs"
                />
              </Campo>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => editar((k) => ({ ...k, enderecos: k.enderecos.filter((_, j) => j !== i) }))}
              aria-label="Remover endereço"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </Secao>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background py-2">
        {sujo && <span className="text-[11px] text-muted-foreground">Alterações não salvas</span>}
        <Button size="sm" onClick={() => salvar()} disabled={!sujo || salvando}>
          {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Salvar
        </Button>
      </div>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir a paleta fixa?</AlertDialogTitle>
            <AlertDialogDescription>
              As próximas artes deste cliente passam a usar a paleta nova. As que já foram geradas não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {gerada && (
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Atual</p>
                <div className="grid grid-cols-3 gap-2">
                  {PAPEIS_DA_PALETA.map((p) => (
                    <Amostra key={p} cor={kit.paleta[p]} pequena />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Nova</p>
                <div className="grid grid-cols-3 gap-2">
                  {PAPEIS_DA_PALETA.map((p) => (
                    <Amostra key={p} cor={gerada[p]} pequena />
                  ))}
                </div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Manter a atual</AlertDialogCancel>
            <AlertDialogAction onClick={() => void usarGerada()}>Substituir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
