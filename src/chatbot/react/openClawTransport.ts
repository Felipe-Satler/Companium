import type { Transport, SendRequest, SendOptions } from '../core/transport';
import type { BotReply } from '../core/types';

export interface OpenClawTransportConfig {
    endpoint: string;
    botId: string;
    // Host supplies current auth headers per call, so token refresh is handled
    getAuthHeaders?: () => Record<string, string>;
    getConversationId?: () => string;
}

export class OpenClawTransport implements Transport {
    constructor(private config: OpenClawTransportConfig) {}

    async send(request: SendRequest, options?: SendOptions): Promise<BotReply> {
        const res = await fetch(this.config.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/x-ndjson', // ask the bridge to stream
                ...this.config.getAuthHeaders?.() ?? {},
            },
            signal: request.signal,
            body: JSON.stringify({
                botId: this.config.botId,
                conversationId: this.config.getConversationId?.(),
                message: { role: request.message.role, content: request.message.content},
                history: request.history.map((m) => ({ role: m.role, content: m.content})),
                ...(request.attachment ? {
                    attachment: {
                        name: request.attachment.name,
                        mimeType: request.attachment.mimeType,
                        dataBase64: request.attachment.dataBase64,
                    },
                } : {}),
            }),
        })

        if(!res.ok){
            let detail = res.statusText;
            try {
                const body = await res.json();
                if (body?.error) detail = body.error;
            } catch {
                // ignore JSON parse errors, use statusText
            }
            throw new Error(`OpenClawTransport: ${res.status} ${detail}`);
        }

        // Non-streaming fallback (e.g. the dev stub returns a plain JSON body).
        const ctype = res.headers.get('content-type') ?? '';
        if (!res.body || ctype.includes('application/json')) {
            return (await res.json()) as BotReply;
        }

        // NDJSON stream: one JSON frame per line.
        //   {"type":"delta","text":"..."}   -> onChunk
        //   {"type":"final","reply":{...}}  -> the authoritative BotReply
        //   {"type":"error","error":"..."}  -> throw
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalReply: BotReply | null = null;
        let acc = ''; // accumulated deltas, used only if no final frame arrives

        const handleLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let frame: { type?: string; text?: string; reply?: BotReply; error?: string };
            try {
                frame = JSON.parse(trimmed);
            } catch {
                return; // ignore a malformed/partial line
            }
            if (frame.type === 'delta' && typeof frame.text === 'string') {
                acc += frame.text;
                options?.onChunk?.(frame.text);
            } else if (frame.type === 'final' && frame.reply) {
                finalReply = frame.reply;
            } else if (frame.type === 'error') {
                throw new Error(frame.error || 'stream error');
            }
        };

        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let nl: number;
                while ((nl = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, nl);
                    buffer = buffer.slice(nl + 1);
                    handleLine(line);
                }
            }
            buffer += decoder.decode(); // flush the decoder
            if (buffer.trim()) handleLine(buffer); // trailing line without a newline
        } finally {
            reader.releaseLock();
        }

        if (finalReply) return finalReply;
        if (acc) return { type: 'message', content: acc }; // defensive: no final frame
        throw new Error('OpenClawTransport: stream ended without a reply');
    }
}