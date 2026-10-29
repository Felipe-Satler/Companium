import "@testing-library/jest-dom";

// jsdom não implementa ResizeObserver, e o ResponsiveContainer do recharts o instancia no
// mount — sem este stub qualquer teste que renderize um gráfico quebra no efeito.
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverStub });
  Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: ResizeObserverStub });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom não implementa scrollIntoView, e o cmdk (por trás do SearchableSelect) rola o item ativo
// para a vista a cada tecla — sem este stub, abrir qualquer select com busca quebra no teste.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
