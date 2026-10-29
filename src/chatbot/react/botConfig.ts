import { supabase } from '@/integrations/external-supabase/client';

export type BotSettings = { bot_id: string; can_switch: boolean; allowed_bots: string[] } | null;
export type Bot = { id: string; label: string; enabled: boolean; is_default: boolean };
export type BotConfig = { settings: BotSettings; bots: Bot[] };

/** React Query key — shared so useChatWidget and useChatbotAccess hit one cache entry. */
export const botConfigKey = (userId: string | null) => ['chatbot-bot-config', userId] as const;

export async function fetchBotConfig(userId: string): Promise<BotConfig> {
    const [settingRes, botsRes] = await Promise.all([
        supabase.from('user_bot_settings').select('bot_id,can_switch,allowed_bots').eq('user_id', userId).maybeSingle(),
        supabase.from('chatbot_bots').select('id,label,enabled,is_default').eq('enabled', true),
    ]);
    return {
        settings: settingRes.data as BotSettings,
        bots: (botsRes.data ?? []) as Bot[],
    };
}

/**
 * Which bot the user should land on, and whether they have one at all.
 *
 * Internal users fall back to the default bot — they always have at least that.
 * Client users get ONLY an explicitly assigned/allowed (and enabled) bot; there is
 * NO default fallback for them, so a client with nothing assigned has no bot and the
 * GrooChat page must stay hidden.
 */
export function resolveBotAccess(
    cfg: BotConfig | undefined,
    isClient: boolean,
): { hasBot: boolean; primary: string | null } {
    if (!cfg) return { hasBot: false, primary: null };
    const { bots, settings } = cfg;
    const enabledId = (id: string | null | undefined) => (!!id && bots.some((b) => b.id === id) ? id! : null);
    const assignedId = enabledId(settings?.bot_id);
    const allowedIds = (settings?.allowed_bots ?? []).filter((id) => bots.some((b) => b.id === id));
    const defaultId = bots.find((b) => b.is_default)?.id ?? null;
    const primary = isClient
        ? assignedId ?? allowedIds[0] ?? null // client: no global-default fallback
        : assignedId ?? defaultId; // internal: default fallback
    return { hasBot: !!primary, primary };
}
