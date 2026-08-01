'use client';

import { useState } from 'react';
import ThoughtChainDrawer from '@/components/ThoughtChainDrawer';
import ArtifactPanel from '@/components/ArtifactPanel';
import { Send, Sparkles, Brain } from 'lucide-react';

export default function Home() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [thinkingText, setThinkingText] = useState('');
  const [routeTarget, setRouteTarget] = useState('gemini-flash');
  const [isThinking, setIsThinking] = useState(false);
  const [currentArtifactCode, setCurrentArtifactCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsThinking(true);
    setThinkingText('');

    try {
      const res = await fetch('/api/neo/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = { role: 'assistant', content: '' };

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === 'status') {
                  setRouteTarget(parsed.data.route);
                } else if (parsed.type === 'thinking') {
                  setThinkingText((prev) => prev + parsed.data);
                } else if (parsed.type === 'content') {
                  setIsThinking(false);
                  assistantMsg.content += parsed.data;

                  if (assistantMsg.content.includes('```html')) {
                    const code = assistantMsg.content.split('```html')?.split('```')[0];
                    if (code) setCurrentArtifactCode(code);
                  }

                  setMessages([...updatedMessages, { ...assistantMsg }]);
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-slate-800/80">
        <header className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base text-white tracking-wide">NEO Agent Platform</h1>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <Brain className="w-3 h-3 text-purple-400" /> DeepSeek R1 + Gemini Flash Engine
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-purple-600 text-white rounded-br-none'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          <ThoughtChainDrawer thinkingText={thinkingText} routeTarget={routeTarget} isThinking={isThinking} />
        </div>

        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800/80 bg-slate-900/30">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask NEO anything or request complex code/research..."
              className="w-full pl-4 pr-12 py-3.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-purple-500"
            />
            <button
              type="submit"
              className="absolute right-2 p-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {currentArtifactCode && (
        <div className="w-[45%] p-4 bg-slate-950">
          <ArtifactPanel code={currentArtifactCode} />
        </div>
      )}
    </div>
  );
}
