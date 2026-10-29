import { useNavigate } from "react-router-dom";
import { Cpu, Palette, PenLine, Pickaxe, Users } from "lucide-react";

/**
 * Cabeçalho da Mineração.
 *
 * Separado do `MarketingHeader` de propósito: aquele é COMPARTILHADO com Paid Media, Social e
 * PACE, então mexer nas abas de lá tiraria a navegação dessas três páginas.
 *
 * Estilo copiado do `ClientesHeader`: pílula segmentada (`inline-flex` num container com borda),
 * ativa em azul. Mesma anatomia do `CaptacaoHeader`, que usa a variante neumórfica.
 */
const tabs = [
  // As análises salvas NÃO estão aqui: vivem na subnavegação de dentro da Mineração, porque são
  // a mesma atividade em outro momento. Aqui ficam só as seções sem relação entre si.
  { label: "Mineração", icon: Pickaxe, path: "/marketing" },
  // Carteira ativa: contexto operacional, relatório por período e documentos de cada cliente.
  // O nome é "Central de Clientes" para não se confundir com a área Clientes (CRM/Performance),
  // que é outra navegação inteira (`ClientesHeader`).
  { label: "Central de Clientes", icon: Users, path: "/marketing/clientes" },
  // Onde as duas anteriores viram post: análise + cliente -> ideia no formato de destino.
  { label: "Composer", icon: PenLine, path: "/marketing/composer" },
  // Onde o anúncio aprovado no Composer vira a arte que vai ser postada (Brand kit + template).
  { label: "Oficina de Artes", icon: Palette, path: "/marketing/oficina" },
];

/**
 * O Orquestrador fica FORA da pílula, sozinho na ponta direita, e com outra cara de propósito: as
 * abas são telas em que a pessoa trabalha; ele é o agente que percorre as três por ela. Se
 * fosse a quarta aba, pareceria mais uma etapa do mesmo caminho.
 */
const ORQUESTRADOR = { label: "Orquestrador", path: "/marketing/orquestrador" };

interface MineracaoHeaderProps {
  activeTab?: string;
}

export function MineracaoHeader({ activeTab = "Mineração" }: MineracaoHeaderProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div>
        <span className="neu-chip mb-1">Marketing</span>
        <p className="text-sm text-muted-foreground">
          Espionagem de criativos: busca anúncios de concorrentes, analisa e guarda o que funciona
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
      {/* Tabs — pílula segmentada (ativa em azul), no padrão de Clientes/Captação. */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-card border border-border shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.label === activeTab;
          return (
            <button
              key={tab.label}
              onClick={() => tab.path && navigate(tab.path)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Os tokens do tema, como as abas: o que o separa delas é a posição, a fonte monoespaçada e
          a borda na cor primária — o bastante para ler como "a máquina" sem destoar da barra. */}
      <button
        onClick={() => navigate(ORQUESTRADOR.path)}
        aria-current={activeTab === ORQUESTRADOR.label ? "page" : undefined}
        className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 font-mono text-[12px] font-semibold uppercase tracking-wider shadow-sm transition-all ${
          activeTab === ORQUESTRADOR.label
            ? "border-primary bg-primary text-primary-foreground"
            : "border-primary/40 bg-card text-primary hover:bg-primary/5"
        }`}
      >
        <Cpu className="h-3.5 w-3.5" />
        {ORQUESTRADOR.label}
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      </button>
      </div>
    </div>
  );
}
