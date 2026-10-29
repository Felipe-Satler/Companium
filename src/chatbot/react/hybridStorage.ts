import { LocalStorageChatStorage, type ChatStorage } from '@/chatbot/core/storage';
import type { ChatMessage } from '@/chatbot/core/types';


// Config do cache. IMPORTANTE: sem "trim" de verdade. O Supabase é a fonte da
// verdade e o shell carrega E espelha o ARRAY INTEIRO — se o cache truncasse
// (o default é 100), o próximo save mandaria menos mensagens pro Supabase e
// apagaria histórico. TTL longo porque o React re-semeia a cada abertura.
const CACHE = { maxMessages: 10_000, ttlMs: 30 * 24 * 60 * 60 * 1000 };

// Escreve um transcript no cache local ANTES de montar o shell, para que o
// load() síncrono do core já encontre as mensagens (semeaedas do Supabase)
export function seedCache(key: string, messages: ChatMessage[]): void {
    new LocalStorageChatStorage({ key, ...CACHE}).save(messages);
}

// ChatStorage que mantém o core síncrono (load/save síncronos via localStorage)
// e espelha as gravações num backend durável (Supabase)
export class HybridChatStorage implements ChatStorage {
    private cache: LocalStorageChatStorage;

    constructor(key: string, private onSave: (messages: ChatMessage[]) => void) {
        this.cache = new LocalStorageChatStorage({ key, ...CACHE });
    }

    load(): ChatMessage[] | null {
        return this.cache.load(); // síncrono, do cache já semeado
    }

    save(messages: ChatMessage[]): void {
        this.cache.save(messages); // cache local instantâneo, offline-safe
        this.onSave(messages); // espelha no backend durável (Supabase)
    }

    clear(): void {
        this.cache.clear(); // só apaga o cache, não apaga no Supabase
    }
}