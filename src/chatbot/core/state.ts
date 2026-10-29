import { ChatMessage } from './types';

// The panel's UI status. A single discriminated field instead of loose
// booleans (isOpen/isLoading/...) so invalid combos can't be represented.
export type UIStatus = 'closed' | 'open' | 'loading' | 'streaming' | 'error';

// The complete state of one chatbot instance. `input` is the current draft
// in the textarea — kept here (not read off the DOM at send time) so there's
// a single source of truth that survives re-renders.
export type ChatState = {
  status: UIStatus;
  messages: ChatMessage[];
  input: string;
  error?: string;
};

export const initialState: ChatState = {
  status: 'closed',
  messages: [],
  input: '',
  error: undefined,
};

// Everything that can happen to the conversation. The orchestrator (later
// step) constructs the ChatMessage objects (ids, timestamps) and the async
// transport call lives there too — the reducer only computes the next state.
export type ChatEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'setInput'; value: string }
  | { type: 'send'; message: ChatMessage }      // optimistic user message
  | { type: 'receive'; message: ChatMessage }   // assistant reply
  | { type: 'streamStart'; message: ChatMessage }  // empty assistant placeholder
  | { type: 'streamChunk'; messageId: string; chunk: string } // append a token
  | { type: 'streamEnd'; message: ChatMessage } // finalize the placeholder
  | { type: 'fail'; messageId?: string; reason: string }
  | { type: 'reset' }
  | { type: 'retry'; messageId: string }
  | { type: 'hydrate'; messages: ChatMessage[] }; // replace transcript (e.g. background reply arrived)

// Pure (state, event) => state. No DOM, no async, no Date.now(), no side
// effects. This is what makes the whole conversation flow unit-testable.
export function reducer(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case 'open':
      return { ...state, status: 'open', error: undefined };

    case 'close':
      return { ...state, status: 'closed' };

    case 'setInput':
      return { ...state, input: event.value };

    case 'send':
      // Append the optimistic user message, clear the draft, enter loading.
      return {
        ...state,
        status: 'loading',
        input: '',
        messages: [...state.messages, event.message],
      };

    case 'receive':
      // Reply arrived: mark any in-flight user messages as sent, append the
      // assistant message, return to the idle 'open' state.
      return {
        ...state,
        status: 'open',
        error: undefined,
        messages: [
          ...state.messages.map((m) =>
            m.status === 'sending' ? { ...m, status: 'sent' as const } : m,
          ),
          event.message,
        ],
      };

    case 'streamStart':
      // A streaming reply began: mark any in-flight user messages as sent and
      // append an empty assistant placeholder we'll grow chunk by chunk.
      return {
        ...state,
        status: 'streaming',
        error: undefined,
        messages: [
          ...state.messages.map((m) => 
            m.status === 'sending' ? { ...m, status: 'sent' as const } : m,
          ),
          event.message,
        ],
      };

    case 'streamChunk':
      // append text to the growing assistant message (matched by id)
      return {
        ...state,
        status: 'open',
        error: undefined,
        messages: state.messages.map((m) =>
          m.id === event.messageId ? { ...m, content: m.content + event.chunk } : m,
      ),
      };

    case 'streamEnd':
      // streaming finished: swap the placeholder for the finalized message
      // (full content + any plot/artifact metadata), return to idle
      return {
        ...state,
        status: 'open',
        error: undefined,
        messages: state.messages.map((m) =>
          m.id === event.message.id ? event.message : m,
        ),
      }

    case 'fail':
      // Transport failed: surface the error and flag the offending message
      // (if we know which one) so the renderer can show a retry affordance.
      return {
        ...state,
        status: 'error',
        error: event.reason,
        messages: state.messages.map((m) =>
          m.id === event.messageId
            ? { ...m, status: 'failed' as const, failureReason: event.reason }
            : m,
        ),
      };
    case 'retry':
    // Flip a failed message back to 'sending' and re-enter loading. The
    // orchestrator will re-call the transport for this message.
    return {
    ...state,
    status: 'loading',
    error: undefined,
    messages: state.messages.map((m) =>
        m.id === event.messageId
        ? { ...m, status: 'sending' as const, failureReason: undefined }
        : m,
    ),
    };

    case 'reset':
      // Clear the conversation but keep the panel open.
      return { ...state, status: 'open', messages: [], input: '', error: undefined };

    case 'hydrate':
      // Replace the transcript wholesale (e.g. a background reply landed while
      // the user was away). Keeps the current UI status.
      return { ...state, messages: event.messages };

    default: {
      // Exhaustiveness guard: if a new ChatEvent is added and not handled,
      // TypeScript errors here at compile time.
      const _exhaustive: never = event;
      return _exhaustive ?? state;
    }
  }
}
