import { describe, it, expect } from "vitest";
import { emojify } from "@/chatbot/core/emoji";
import { renderMessages } from "@/chatbot/core/render";
import type { ChatMessage } from "@/chatbot/core/types";

function bot(content: string): ChatMessage {
  return { id: "m1", role: "assistant", content, timestamp: Date.now() } as ChatMessage;
}

function renderBot(content: string): string {
  const el = document.createElement("div");
  renderMessages(el, [bot(content)]);
  return el.querySelector(".msg-content")!.innerHTML;
}

describe("emojify", () => {
  it("expands known shortcodes", () => {
    expect(emojify("deploy ok :rocket: :white_check_mark:")).toBe("deploy ok 🚀 ✅");
  });

  it("leaves unknown shortcodes verbatim", () => {
    expect(emojify("custo :cpa: subiu")).toBe("custo :cpa: subiu");
  });

  it("does not touch times or ratios", () => {
    expect(emojify("às 10:30:00 o CPA foi 1:2:1")).toBe("às 10:30:00 o CPA foi 1:2:1");
  });
});

describe("bot message rendering", () => {
  it("keeps literal emoji, including outside the BMP", () => {
    expect(renderBot("tudo certo 🎉👍🏽")).toContain("tudo certo 🎉👍🏽");
  });

  it("expands shortcodes in prose", () => {
    expect(renderBot("resultado :fire:")).toContain("resultado 🔥");
  });

  it("keeps shortcodes literal inside code", () => {
    const html = renderBot("use `:rocket:` no texto");
    expect(html).toContain(":rocket:");
    expect(html).not.toContain("🚀");
  });

  it("expands emoji inside markdown structure", () => {
    const html = renderBot("- **feito** :white_check_mark:");
    expect(html).toContain("<li>");
    expect(html).toContain("✅");
  });

  it("still sanitizes bot HTML", () => {
    const html = renderBot('<img src=x onerror="alert(1)"> :tada:');
    expect(html).not.toContain("onerror");
    expect(html).toContain("🎉");
  });

  it("does not expand shortcodes in user messages", () => {
    const el = document.createElement("div");
    renderMessages(el, [{ ...bot("nota :rocket:"), role: "user" } as ChatMessage]);
    expect(el.querySelector(".msg-content")!.textContent).toBe("nota :rocket:");
  });
});
