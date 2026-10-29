import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/integrations/external-supabase/client", () => ({ supabase: {}, EXTERNAL_SUPABASE_URL: "", EXTERNAL_SUPABASE_ANON_KEY: "" }));

import { UsoTempo } from "@/components/uso/UsoTempo";
import { UsoNavegacao } from "@/components/uso/UsoNavegacao";
import { UsoAdocao } from "@/components/uso/UsoAdocao";
import { UsoAgentes } from "@/components/uso/UsoAgentes";
import { UsoEquipes } from "@/components/uso/UsoEquipes";
import { fireEvent } from "@testing-library/react";
import type { UsoDiaRow, UsoUsuario } from "@/lib/usage/agregar";

const usuarios: UsoUsuario[] = [
  { id: "u1", email: "ana@example.com", tipo: "equipe" },
  { id: "u2", email: "bia@cliente.com", tipo: "cliente" },
];
const porId = new Map(usuarios.map((u) => [u.id, u]));
const rows: UsoDiaRow[] = [
  { dia: "2026-10-19", user_id: "u1", screen_key: "clientes.crm", active_ms: 30 * 60_000, visits: 3, clicks: 10 },
  { dia: "2026-10-20", user_id: "u2", screen_key: "marketing.composer", active_ms: 12 * 60_000, visits: 1, clicks: 4 },
];
const dias = ["2026-10-19", "2026-10-20"];

const envolver = (ui: React.ReactNode) => render(<ThemeProvider><TooltipProvider>{ui}</TooltipProvider></ThemeProvider>);

describe("abas da página Uso", () => {
  it("Tempo: mapa usuário × tela e detalhamento", () => {
    envolver(<UsoTempo rows={rows} dias={dias} escopo={null} usuarios={porId} />);
    expect(screen.getByText("Quem usa o quê")).toBeInTheDocument();
    expect(screen.getAllByText("ana").length).toBeGreaterThan(0);
    expect(screen.getAllByText("30 min").length).toBeGreaterThan(0);
  });

  it("Tempo sem dados mostra o estado vazio", () => {
    envolver(<UsoTempo rows={[]} dias={dias} escopo={null} usuarios={porId} />);
    expect(screen.getByText(/Nenhum uso registrado/)).toBeInTheDocument();
  });

  it("Navegação: transições fora do filtro viram 'Outras telas'", () => {
    envolver(
      <UsoNavegacao
        escopo={["clientes.*"]}
        dados={{
          transicoes: [
            { de: "_inicio", para: "clientes.crm", n: 5, usuarios: 2 },
            { de: "clientes.crm", para: "marketing.composer", n: 3, usuarios: 1 },
          ],
          cliques: [{ screen_key: "clientes.crm", target_key: "button:salvar", label: "Salvar", n: 7, usuarios: 2 }],
          sequencias: [{ a: "x", b: "y", c: "z", la: "Filtro", lb: "Aplicar", lc: "Exportar", n: 4, usuarios: 2 }],
          saidas: [{ screen_key: "clientes.crm", n: 2 }],
        }}
      />,
    );
    expect(screen.getAllByText("Outras telas").length).toBeGreaterThan(0);
    expect(screen.getByText("Salvar")).toBeInTheDocument();
    expect(screen.getByText("Aplicar")).toBeInTheDocument();
  });

  it("Adoção: % por tela e heatmap de horário", () => {
    envolver(<UsoAdocao rows={rows} dias={dias} horarios={[{ dow: 1, hora: 9, active_ms: 600_000, usuarios: 1 }]} />);
    expect(screen.getByText("Adoção por tela")).toBeInTheDocument();
    expect(screen.getByText("Seg")).toBeInTheDocument();
  });

  it("Agentes de IA: nome do agente, perguntas e textos recebidos", () => {
    envolver(
      <UsoAgentes
        dias={dias}
        usuarios={porId}
        dados={{
          bots: [{ id: "b1", label: "Assistente Geral" }],
          linhas: [{ dia: "2026-10-19", user_id: "u1", bot_id: "b1", active_ms: 300_000, sessoes: 1, perguntas: 4, respostas: 3 }],
        }}
      />,
    );
    expect(screen.getByText("Assistente Geral")).toBeInTheDocument();
    expect(screen.getByText("Textos recebidos", { selector: "p" })).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("Equipes: compara por membro e mostra a equipe por dentro com a média", () => {
    envolver(
      <UsoEquipes
        diario={rows}
        agentes={[]}
        usuarios={usuarios}
        dias={dias}
        escopoUsuarios={null}
        dados={{
          equipes: [{ id: "e1", nome: "Tráfego", arquivada: false }],
          membros: [{ user_id: "u1", equipe_id: "e1", inicio_dia: null, fim_dia: null }],
        }}
      />,
    );
    expect(screen.getByText("Comparativo das equipes")).toBeInTheDocument();
    expect(screen.getAllByText("Tráfego").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clientes").length).toBeGreaterThan(0); // u2 é cliente
    fireEvent.click(screen.getByRole("radio", { name: "Dentro de uma equipe" }));
    expect(screen.getByText("Membros — Tráfego")).toBeInTheDocument();
    expect(screen.getByText("Média da equipe")).toBeInTheDocument();
  });

  it("Equipes sem cadastro orienta a criar na Administração", () => {
    envolver(<UsoEquipes diario={rows} agentes={[]} usuarios={usuarios} dias={dias} escopoUsuarios={null} dados={{ equipes: [], membros: [] }} />);
    expect(screen.getByText(/Administração › Equipes/)).toBeInTheDocument();
  });
});
