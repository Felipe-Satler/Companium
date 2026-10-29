import { useNavigate } from "react-router-dom";
import { Library, Microscope, Pickaxe } from "lucide-react";

/**
 * Navegação de segundo nível, dentro de Mineração.
 *
 * As duas são a mesma atividade em dois momentos — minerar agora e reler o que já foi analisado —,
 * então dividem o espaço aqui dentro em vez de ocupar duas abas no topo. O topo fica com as
 * seções de Marketing que não têm relação entre si (Mineração, Clientes, Composer).
 *
 * Visualmente menor que a pílula do cabeçalho de propósito: hierarquia só existe se as duas
 * barras forem distinguíveis à primeira vista.
 */
const tabs = [
  { label: "Nova Mineração", icon: Pickaxe, path: "/marketing" },
  // Minerações salvas por toda a equipe, filtráveis por segmento.
  { label: "Minerações Salvas", icon: Library, path: "/marketing/biblioteca" },
  // A dissecação de UM anúncio, pedida de dentro dele ("Analisar Criativo").
  { label: "Análises de Criativos", icon: Microscope, path: "/marketing/criativos" },
];

export type MineracaoSubnavTab = (typeof tabs)[number]["label"];

export function MineracaoSubnav({ activeTab }: { activeTab: MineracaoSubnavTab }) {
  const navigate = useNavigate();

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.label === activeTab;
        return (
          <button
            key={tab.label}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => navigate(tab.path)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
