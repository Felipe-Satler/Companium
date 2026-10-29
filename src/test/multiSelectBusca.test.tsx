/**
 * Busca dentro do multi-seleção de especialidades.
 *
 * A lista de especialidades é longa (vem da tabela de clientes), e o campo existe para FILTRAR —
 * nunca para inventar um termo novo. Um valor escrito à mão não casaria com a lista de origem e o
 * filtro da Biblioteca deixaria de encontrar a análise depois.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetasMultiSelect } from "@/components/clientes/metas/MetasMultiSelect";

const OPTIONS = [
  "Harmonização Facial",
  "Cirurgia Plástica",
  "Transplante Capilar",
  "Odontologia",
].map((e) => ({ id: e, label: e }));

function abrir(props: Partial<React.ComponentProps<typeof MetasMultiSelect>> = {}) {
  const onChange = vi.fn();
  render(
    <MetasMultiSelect
      title="Especialidades"
      options={OPTIONS}
      selected={[]}
      onChange={onChange}
      placeholder="Escolha uma ou mais"
      pluralNoun="especialidades"
      searchable
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /escolha uma ou mais/i }));
  return { onChange };
}

describe("MetasMultiSelect com busca", () => {
  it("filtra a lista conforme se digita, ignorando acento e caixa", () => {
    abrir();
    expect(screen.getByText("Odontologia")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/filtrar especialidades/i), {
      target: { value: "harmonizacao" },
    });
    expect(screen.getByText("Harmonização Facial")).toBeInTheDocument();
    expect(screen.queryByText("Odontologia")).not.toBeInTheDocument();
  });

  it("não deixa criar termo novo: o que não está na lista não vira opção", () => {
    const { onChange } = abrir();
    const campo = screen.getByLabelText(/filtrar especialidades/i);
    fireEvent.change(campo, { target: { value: "Dermatologia Capilar" } });
    expect(screen.getByText(/nada encontrado/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // Nem Enter cria: o campo só filtra.
    fireEvent.keyDown(campo, { key: "Enter", code: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ainda dá para marcar uma opção depois de filtrar", () => {
    const { onChange } = abrir();
    fireEvent.change(screen.getByLabelText(/filtrar especialidades/i), {
      target: { value: "capilar" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(["Transplante Capilar"]);
  });

  it("sem `searchable`, nada muda para as listas curtas", () => {
    abrir({ searchable: false });
    expect(screen.queryByLabelText(/filtrar especialidades/i)).not.toBeInTheDocument();
    expect(screen.getByText("Odontologia")).toBeInTheDocument();
  });
});
