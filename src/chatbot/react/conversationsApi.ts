import { supabase } from "@/integrations/external-supabase/client"
import type { ChatMessage } from "@/chatbot/core/types"

// Um tópico (linha de chatbot_conversation). É a lista leve, sem o conteúdo
export type Conversation = {
    id: string;
    bot_id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

// lista os tópicos de um bot, mais recentes no topo
export async function listConversations(userId: string, botId: string): Promise<Conversation[]> {
    const { data, error } = await supabase
        .from("chatbot_conversations")
        .select('id,bot_id,title,created_at,updated_at')
        .eq('user_id', userId)
        .eq('bot_id', botId)
        .order('updated_at', { ascending: false} );
    if (error) throw error;
    return (data ?? []) as Conversation[];
}

// Cria um tṕico com um id gerado NO CLIENTE (o mesmo id que vira conversationId -> sessão/memória do OpenClaw)
// por isso passamos o id em vez de deixar o default
export async function createConversation(userId: string, botId: string, id: string, title = "Nova conversa"): Promise<Conversation> {
    const { data, error } = await supabase
        .from('chatbot_conversations')
        .insert({ id, user_id: userId, bot_id: botId, title })
        .select('id,bot_id,title,created_at,updated_at')
        .single();
    if (error) throw error;
    return data as Conversation;
}

// renomear (usado pelo "Renomear" manual e, depois, pelo título automático)
export async function renameConversation(id: string, title: string): Promise<void> {
    const { error } = await supabase
        .from('chatbot_conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

// apagar o tópico. O transcript vai junto via ON DELETE CASCADE (Etapa 1
export async function deleteConversation(id: string): Promise<void> {
    const { error } = await supabase
        .from('chatbot_conversations')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// carrega o blob de mensagens de uma conversa (array vazio se ainda não existe)
export async function loadTranscript(conversationId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
        .from('chatbot_transcripts')
        .select('messages')
        .eq('conversation_id', conversationId)
        .maybeSingle();
    if (error) throw error;
    return (data?.messages ?? []) as ChatMessage[];
}

// sobrecreve o blob inteiro (bate com o save(messages) do shell) e "toca" o updated_at do tópico para ele subir para o topo da lista
export async function saveTranscript(conversationId: string, userId: string, messages: ChatMessage[]): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('chatbot_transcripts')
        .upsert({ conversation_id: conversationId, user_id: userId, messages, updated_at: now},
                {onConflict: 'conversation_id'}
        );
    if (error) throw error;
    await supabase.from('chatbot_conversations').update({ updated_at: now}).eq('id', conversationId);
}