import { ServiceType } from './types';

export type ChatAuditEventType =
    | 'open'
    | 'close'
    | 'reset'
    | 'message_send'
    | 'reply'
    | 'error';


// Per-interaction metadata for the structured audit log. METADATA ONLY
// never raw conversation text. The core emit this; the host ships it
// (to a supabase table / edge function, later). the core know no destination
export interface ChatAuditEvent {
    type: ChatAuditEventType;
    botSessionId: string; // one widget session (this mount)
    traceId?: string; // one send round-trip (correlates send <0> reply/error)
    timestamp: number;

    // request metada - shape only, no text
    inputKind?: 'free_text' | 'option';
    textLength?: number;

    // classification / action, read off the reply
    intentType?: 'message' | 'service_request';
    service?: ServiceType;
    hasArtifact?: boolean;
    hasPlot?: boolean;

    // outcome
    status?: 'ok' | 'error';
    durationMs?: number;
    errorMessage?: string; // transṕrt error text (network/HTTP) - host may scrub
}
