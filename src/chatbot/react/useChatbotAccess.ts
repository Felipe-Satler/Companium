import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { botConfigKey, fetchBotConfig, resolveBotAccess } from './botConfig';

/**
 * Whether the current user has a chatbot available (drives the sidebar item and the
 * /assistente route guard). Internal users always do (default bot); client users only
 * when a bot is assigned/allowed to them. Shares the bot-config query cache with
 * useChatWidget, so this adds no extra fetch when the page is open.
 */
export function useChatbotAccess() {
    const { user, clientUser } = useAuth();
    const userId = user?.id ?? null;

    const { data: botConfig } = useQuery({
        queryKey: botConfigKey(userId),
        enabled: !!userId,
        queryFn: () => fetchBotConfig(userId!),
    });

    const hasBot = useMemo(() => resolveBotAccess(botConfig, !!clientUser).hasBot, [botConfig, clientUser]);
    // Still deciding while we have a user but the config hasn't come back yet.
    const isLoading = !!userId && botConfig === undefined;

    return { hasBot, isLoading };
}
