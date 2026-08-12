'use client';

import { useEffect, useRef, useState } from 'react';

export interface Citation {
  chunk_index: number;
  label: string;
  text_preview: string;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
  isError?: boolean;
  isStreaming?: boolean;
}

interface ChatPanelProps {
  materialId: string;
  userId: string;
  suggestions?: string[];
  /** Called when a citation badge is clicked, to reveal that page's source text. */
  onCitationClick?: (citation: Citation) => void;
}

const DEFAULT_SUGGESTIONS = [
  'Summarise the main idea',
  'Key terms to memorise',
  'Explain the hardest concept simply',
];

export default function ChatPanel({
  materialId,
  userId,
  suggestions = DEFAULT_SUGGESTIONS,
  onCitationClick,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  // A pending stream must not outlive the panel.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Replaces the trailing assistant message, which is the one being streamed. */
  const updateLast = (patch: Partial<Message>) => {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === 'ai') next[next.length - 1] = { ...last, ...patch };
      return next;
    });
  };

  const send = async (question: string) => {
    if (!question.trim() || isStreaming) return;

    setInput('');
    setMessages((current) => [
      ...current,
      { role: 'user', content: question },
      { role: 'ai', content: '', isStreaming: true },
    ]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/materials/${materialId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, user_id: userId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'The assistant is unavailable right now.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';

      // The route emits newline-delimited JSON; a chunk can split mid-line, so
      // the trailing partial stays in the buffer until its newline arrives.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let event: { type: string; text?: string; citations?: Citation[]; error?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === 'citations') updateLast({ citations: event.citations ?? [] });
          if (event.type === 'delta') {
            answer += event.text ?? '';
            updateLast({ content: answer });
          }
          if (event.type === 'error') throw new Error(event.error || 'The answer stream failed.');
        }
      }

      updateLast({ isStreaming: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      updateLast({
        content: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        isError: true,
        isStreaming: false,
        citations: undefined,
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  return (
    <div className="glass-panel rounded-2xl flex flex-col h-[540px] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="material-symbols-outlined text-[#4cd7f6]" style={{ fontSize: '20px' }}>forum</span>
        <h3 className="text-sm font-semibold text-[#dfe2f1]" style={{ fontFamily: 'var(--font-outfit)' }}>
          Ask your material
        </h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-[#908fa0]">Cited answers</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <span className="material-symbols-outlined text-[#464554] mb-3" style={{ fontSize: '44px' }}>quiz</span>
            <p className="text-[#c7c4d7] text-sm font-medium">Ask anything about this document</p>
            <p className="text-[#908fa0] text-xs mt-1 mb-4">Every answer cites the page it came from</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => send(suggestion)}
                  className="text-left text-xs px-3 py-2.5 rounded-lg bg-[#262a35]/70 border border-[#464554] text-[#c7c4d7] hover:border-[#8083ff]/50 hover:text-[#dfe2f1] transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, messageIndex) => (
          <div key={messageIndex} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-[#8083ff]/25 text-[#dfe2f1] rounded-br-md border border-[#8083ff]/20'
                  : message.isError
                    ? 'bg-[#ff516a]/10 text-[#ffb2b7] rounded-bl-md border border-[#ff516a]/25'
                    : 'bg-[#1c1f2a] text-[#dfe2f1] rounded-bl-md border border-[#464554]/50'
              }`}
            >
              {message.content ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {message.content}
                  {message.isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-[#4cd7f6] animate-pulse" />}
                </p>
              ) : (
                <div className="flex gap-1.5 py-1">
                  {[0, 150, 300].map((delay) => (
                    <div
                      key={delay}
                      className="w-2 h-2 rounded-full bg-[#8083ff] animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              )}

              {message.citations && message.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-white/5">
                  {message.citations.map((citation) => (
                    <button
                      key={citation.chunk_index}
                      onClick={() => onCitationClick?.(citation)}
                      title={citation.text_preview}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium bg-[#03b5d3]/15 text-[#4cd7f6] border border-[#4cd7f6]/20 hover:bg-[#03b5d3]/30 hover:border-[#4cd7f6]/50 transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>format_quote</span>
                      {citation.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input.trim());
        }}
        className="p-3 border-t border-white/5"
      >
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about your material…"
            aria-label="Ask a question about your material"
            disabled={isStreaming}
            className="flex-1 bg-[#262a35] border border-[#464554] rounded-xl px-4 py-2.5 text-sm text-[#dfe2f1] placeholder:text-[#908fa0]/60 transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            aria-label="Send question"
            className="w-11 h-11 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] flex items-center justify-center disabled:opacity-30 hover:scale-105 transition-transform disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <span className="material-symbols-outlined text-[#0f131d]" style={{ fontSize: '20px' }}>send</span>
          </button>
        </div>
      </form>
    </div>
  );
}
