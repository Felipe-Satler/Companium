

export type Role = 'user' | 'assistant' | 'system';

export type ChatMessage = {
    id: string;
    role: Role;
    content: string;
    timestamp: number;
    status?: 'sending' | 'sent' | 'failed';
    failureReason?: string;
    metadata?: MessageMetadata;
    attachment?: { name: string, mimeType: string }; // optional reference to an InputAttachment the user sent
}


export type Artifact = {
    kind: 'pdf' | 'png' | 'md';
    filename: string;
    mimeType: string;
    source: string;
}

// Arquivo que o usuário anexa a uma mensagem (imagem/PDF) para o bot ler.
// dataBase64 (sem o prefixo data:) só trafega até o transport; a mensagem
// persistida guarda apenas name + mimeType (ver ChatMessage.attachment).
export type InputAttachment = {
    name: string;
    mimeType: string;
    dataBase64: string;
}

export type PlotRef = {
    id: string;               // DB id
    title?: string;
    thumbnailUrl?: string;    // optional static preview for the bubble
    spec?: unknown;           // opaque chart spec the HOST renderer understands
}

export type MessageMetadata = {
    intentType?: 'message' | 'service_request';
    service?: ServiceType;
    artifact?: Artifact;
    plot?: PlotRef;
    actionResults?: ActionResult[];
}

export type ServiceType = 'export' | 'plot';

export type BotReply =
    | { type: 'message'; content: string }
    | {
        plot?: PlotRef; type: 'service_request'; service: ServiceType; content: string; artifact?: Artifact; actionResults?: ActionResult[] 
};

export type ActionResult = {
    action: string;
    result: string;
}

// Deliverables produced during a conversation (plots + documents), derived from
// message metadata. Used by the host's side panel. `key` is a stable id for
// detach/dedupe.
export type ConversationItem =
    | { kind: 'plot'; key: string; msgId: string; id: string; title?: string; spec?: unknown; thumbnailUrl?: string }
    | { kind: 'artifact'; key: string; msgId: string; filename: string; mimeType: string; source: string; artifactKind: Artifact['kind'] };