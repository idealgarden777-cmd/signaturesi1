'use client';

import { useState, useRef, useEffect } from 'react';
import ThoughtChainDrawer from '@/components/ThoughtChainDrawer';
import ArtifactPanel from '@/components/ArtifactPanel';
import { Send, Sparkles, Brain, AlertCircle, X, Cpu } from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export default function Home() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinkingText, setThinkingText] = useState('');
  const [routeTarget, setRouteTarget] = useState('gemini-3.1-flash-lite');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'deepseek-v4-flash' | 'gemini-3.1-flash-lite'>('deepseek-v4-flash');
  const [currentArtifactCode, setCurrentArtifactCode] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    setErrorBanner(null);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsStreaming(true);
    setIsThinking(true);
    setThinkingText('');

    try {
      const res = await fetch('/api/neo/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          selectedModel,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}: Failed to generate response`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      const assistantMsgId = crypto.randomUUID();
      let assistantContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));

                if (parsed.type === 'status') {
                  setRouteTarget(parsed.data.route);
                } else if (parsed.type === 'thinking') {
                  setThinkingText((prev) => prev + (parsed.data || ''));
                } else if (parsed.type === 'content') {
                  setIsThinking(false);
                  assistantContent += parsed.data || '';

                  // Parse code blocks safely
                  if (assistantContent.includes('```html')) {
                    const parts = assistantContent.split('```html');
                    if (parts.length > 1 && parts) {
                      const codeBlock = parts.split('```')[0];
                      if (codeBlock) setCurrentArtifactCode(codeBlock.trim());
                    }
                  }

                  const assistantMsg: ChatMessage = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  };

                  setMessages([...updatedMessages, assistantMsg]);
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.data.error || 'Stream execution error');
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setErrorBanner(message);
    } finally {
      setIsThinking(false);
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-slate-800/80 min-w-0">
        <header className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base text-white tracking-wide">NEO Agent Platform</h1>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-purple-400" /> Active: {routeTarget}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-slate-400" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as any)}
              disabled={isStreaming}
              className="bg-slate-900 border border-slate-700/80 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-purple-500 disabled:opacity-50 transition-all cursor-pointer"
            >
              <option value="deepseek-v4-flash">DeepSeek V4-Flash (Reasoning)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fast)</option>
            </select>
          </div>
        </header>

        {errorBanner && (
          <div className="px-6 py-3 bg-red-900/40 border-b border-red-500/30 text-red-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorBanner}</span>
            </div>
            <button onClick={() => setErrorBanner(null)} className="p-1 text-red-300 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                m.role === 'user' ? 'bg-purple-600 text-white rounded-br-none' : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
              }`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                <span className="block text-[10px] mt-1.5 opacity-60 text-right">{m.timestamp}</span>
              </div>
            </div>
          ))}

          <ThoughtChainDrawer thinkingText={thinkingText} routeTarget={routeTarget} isThinking={isThinking} />
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800/80 bg-slate-900/30">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isStreaming}
              placeholder={isStreaming ? 'NEO is streaming a response...' : 'Ask NEO anything or request UI code/research...'}
              className="w-full pl-4 pr-12 py-3.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-purple-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="absolute right-2 p-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 text-white rounded-lg transition-all disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {currentArtifactCode && (
        <div className="w-[45%] min-w-[360px] p-4 bg-slate-950 border-l border-slate-800/80 hidden lg:block">
          <ArtifactPanel code={currentArtifactCode} />
        </div>
      )}
    </div>
  );
}
