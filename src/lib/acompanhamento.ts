// O que este navegador está esperando terminar: orquestrações e composições disparadas aqui.
//
// Existe porque as duas levam de minutos a dezenas de minutos, e a tela que as mostra só faz
// polling enquanto está aberta. Quem dispara e vai trabalhar em outra aba só descobria o fim
// voltando para olhar. A lista mora em `localStorage` para sobreviver a um F5 e valer em qualquer
// aba do app; quem a consome é `AvisoDeConclusao`, montado uma vez acima das rotas.

export type Acompanhado = {
  tipo: "orquestracao" | "composicao";
  id: string;
  /** O nome do cliente, para o aviso dizer DE QUEM é o que terminou. */
  nome: string;
};

const CHAVE = "companium:acompanhando";
const EVENTO = "companium:acompanhando";
// Teto: é uma fila de avisos pendentes, não um histórico. O que passar disso é descartado do começo.
const MAX = 12;

/** Nunca lança: `localStorage` pode estar bloqueado (modo privado, cota), e aviso é conforto. */
export function lerAcompanhados(): Acompanhado[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(bruto) ? bruto.filter((x) => x?.id && x?.tipo) : [];
  } catch {
    return [];
  }
}

function gravar(lista: Acompanhado[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(-MAX)));
  } catch {
    /* sem armazenamento, sem aviso: a tela aberta continua mostrando o progresso */
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function acompanhar(item: Acompanhado) {
  gravar([...lerAcompanhados().filter((x) => x.id !== item.id), item]);
}

export function soltar(id: string) {
  gravar(lerAcompanhados().filter((x) => x.id !== id));
}

/** Avisa quando a lista muda — nesta aba (evento próprio) ou em outra (`storage`). */
export function aoMudarAcompanhados(fn: () => void) {
  window.addEventListener(EVENTO, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENTO, fn);
    window.removeEventListener("storage", fn);
  };
}

/**
 * Pede permissão para notificação do sistema, se ainda não foi respondida.
 *
 * Chamada NO CLIQUE de disparar: navegador só mostra o pedido em resposta a um gesto, e é nessa
 * hora que a pessoa entende para que serve. Recusar não quebra nada — sobra o aviso dentro do app.
 */
export function pedirPermissaoDeAviso() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* navegador sem a API */
  }
}
