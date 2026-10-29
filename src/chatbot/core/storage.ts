import { ChatMessage } from './types';

// The core persists the transcript through this interface only. Default impl is localStorage
// a host could swap in sessionStorage, IndexedDB or a no-op
export interface ChatStorage {
    load(): ChatMessage[] | null;
    save(messages: ChatMessage[]): void;
    clear(): void;
}

// What actually gets serialized: messages plus a savedAt stamp for TTL checks
type StoredEnvelope = {
    savedAt: number;
    messages: ChatMessage[];
}

export interface LocalStorageConfig {
    // namespaced so it can't collide with app-theme / groohub-auth / etc
    key?: string;
    // Max age before a stored transcript is considered stale and discarded
    ttlMs?: number;
    // Keep only the most recent N messages (caps size and parse cost)
    maxMessages?: number;
}

const DEFAULTS = {
    key: 'groohub:chatbot:v1:transcript',
    ttlMs: 24 * 60 * 60 * 1000, // 24h
    maxMessages: 100,
}

export class LocalStorageChatStorage implements ChatStorage {
    private key: string;
    private ttlMs: number;
    private maxMessages: number;

    constructor(config: LocalStorageConfig = {}) {
        this.key = config.key ?? DEFAULTS.key;
        this.ttlMs = config.ttlMs ?? DEFAULTS.ttlMs;
        this.maxMessages = config.maxMessages ?? DEFAULTS.maxMessages;
    }

    load(): ChatMessage[] | null {
        try {
            const raw = localStorage.getItem(this.key);
            if (!raw) return null;

            const env = JSON.parse(raw) as StoredEnvelope;
            if (!env || !Array.isArray(env.messages)) return null;

            // TTL: expired transcript is dropped, not returned
            if (Date.now() - env.savedAt > this.ttlMs) {
                this.clear();
                return null;
            }

            return env.messages;
        } catch {
            // Corrupted JSON, blocked storage, etc. - fail soft
            return null;
        }
    }

    save(messages: ChatMessage[]): void {
        try {
            // Size cap: only persist the most recent N messages
            const trimmed = messages.slice(-this.maxMessages);
            const env: StoredEnvelope = { savedAt: Date.now(), messages: trimmed};
            localStorage.setItem(this.key, JSON.stringify(env));
        } catch {
            // Blocked storage, quota exceeded, etc. - fail soft, never crash the chat
        }
    }

    clear(): void {
        try {
            localStorage.removeItem(this.key);
        } catch {
            // Blocked storage, etc. - fail soft, never crash the chat
        }
    }
}