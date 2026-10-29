import { BotReply, ChatMessage, InputAttachment } from './types';

// What the host's transport receives when the user sends something.
// We pass the new message AND the prior history so the backend can classify
// the free text with conversational context. `signal` lets the core cancel
// an in-flight request (e.g. on close/reset).
export interface SendRequest {
    message: ChatMessage;
    history: ChatMessage[];
    signal: AbortSignal;
    attachment?: InputAttachment; // ← base64 cheio, só para envio (não persiste)
}

// Streaming-readiness lives here, not in the signature. A non-streaming
// transport ignores `onChunk` and just resolves with the full reply. A future
// streaming transport calls `onChunk` as tokens arrive, then resolves with the
// final assembled BotReply. The interface stays stable either way.
export interface SendOptions {
    onChunk?: (textChunk: string) => void;
}

// The core depends ONLY on this interface. It knows nothing about HTTP, the
// LLM, intents, or CRM routes — all of that lives behind the host's impl.
export interface Transport {
  send(request: SendRequest, options?: SendOptions): Promise<BotReply>;
}

export interface MockTransportConfig {
  delayMs?: number;
  // Return value decides what the mock replies for a given user text.
  // Default: echo as a plain 'message'. Override to test the export flow.
  reply?: (text: string) => BotReply;
  // If it returns a string, the send rejects with that as the error message.
  failWith?: (text: string) => string | null;
}

export class MockTransport implements Transport {
  constructor(private config: MockTransportConfig = {}) {}

  send(request: SendRequest, options?: SendOptions): Promise<BotReply> {
    const text = request.message.content;
    const delay = this.config.delayMs ?? 600;

    return new Promise<BotReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const failure = this.config.failWith?.(text);
        if (failure) {
          reject(new Error(failure));
          return;
        }

        const reply: BotReply = this.config.reply
          ? this.config.reply(text)
          : { type: 'message', content: `You said: ${text}` };

        // Simulate token streaming: emit the text in small slices on a timer,
        // then resolve with the whole reply. A real transport has the same
        // shape (many onChunk calls, one final resolve).
        if (options?.onChunk && reply.type === 'message') {
          const parts = reply.content.match(/\S+\s*/g) ?? [reply.content];
          let i = 0;
          const step = () => {
            if (request.signal?.aborted) return; // abort listener rejects
            if (i < parts.length) {
              options.onChunk!(parts[i++]);
              setTimeout(step, 45);
            } else {
              resolve(reply);
            }
          };
          step();
          return;
        }

        resolve(reply);
      }, delay);

      // Honor cancellation so close/reset can abort an in-flight mock call.
      request.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }
}
