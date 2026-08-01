'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Sparkles,
  ChevronDown,
  Sun,
  Copy,
  Share2,
  RotateCw,
  Mic,
  ArrowUp,
  Settings,
  SquarePen,
  Code2,
  FileText,
  ListTodo,
  Wand2,
  Search,
  Check
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default function Home() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'user',
      content: 'Explain quantum computing in simple terms.'
    },
    {
      id: '2',
      role: 'assistant',
      content: `Quantum computing ka basic concept bits aur qubits ka farq hai. Normal computers mein data bits (0 ya 1) mein store hota hai, lekin quantum computers mein qubits hote hain jo ek hi waqt mein 0 aur 1 dono states mein reh sakte hain. Is phenomenon ko superposition kehte hain.\n\nIska asli fayda entanglement se milta hai, jahan qubits aapas mein is tarah jud jaate hain ke ek ki state dusre ko instant affect karti hai, chahe wo kitni hi door kyun na ho. Iski wajah se quantum computers complex problems ko parallel process kar sakte hain, jo aaj ke supercomputers ke liye solve karna namumkin hai.\n\nSocho ke agar tumhein ek maze (bhal bhulaiya) se bahar nikalna ho, toh normal computer har rasta ek-ek karke check karega. Quantum computer saare raaste ek saath check kar sakta hai aur seedha exit dhoond lega. Ye technology abhi apne shuruati daur mein hai, lekin future mein ye medicine, encryption aur material science mein revolutionary changes la sakti hai.`
    }
  ]);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState('NEO L1.0');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  const [recentChats, setRecentChats] = useState<string[]>([
    'Explain quantum computing in si...',
    'how are you can you summarise...',
    'hi',
    'Explain quantum computing in si...',
    'How to add website link in TikTo...',
    'What is agi',
    'elon musk current net worth',
    'Help me outline a business plan f...',
    'Write a Python script to scrape w...'
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const handleQuickAction = (actionText: string) => {
    setInput(actionText + ' ');
  };

  const handleNewConversation = () => {
    setMessages([]);
    setInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userPrompt = input.trim();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userPrompt
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsStreaming(true);

    // Add to recent chats list
    setRecentChats((prev) => [userPrompt.slice(0, 28) + '...', ...prev]);

    try {
      const res = await fetch('/api/neo/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          selectedModel: 'deepseek-v4-flash'
        }),
      });

      if (!res.ok) throw new Error('Failed to generate response');

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
                if (parsed.type === 'content') {
                  assistantContent += parsed.data || '';
                  
                  const assistantMsg: ChatMessage = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: assistantContent
                  };

                  setMessages([...updatedMessages, assistantMsg]);
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#fcfcfc] text-slate-800 font-sans antialiased overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-64 bg-[#f4f4f6] border-r border-slate-200/80 flex flex-col justify-between p-3 select-none">
        <div>
          {/* Header Title */}
          <div className="flex items-center justify-between px-2 py-1 mb-4">
            <div>
              <h1 className="font-bold text-sm text-slate-900 tracking-tight">NEO Engine</h1>
              <p className="text-[11px] text-slate-500">Signaturesi Central</p>
            </div>
            <button className="text-slate-400 hover:text-slate-700 p-1 rounded-md">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="space-y-1 mb-6">
            <button
              onClick={handleNewConversation}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all"
            >
              <SquarePen className="w-4 h-4 text-slate-600" />
              <span>New Conversation</span>
            </button>
            <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all">
              <Sparkles className="w-4 h-4 text-slate-600" />
              <span>NEO Personalities</span>
            </button>
          </div>

          {/* Recent Chats List */}
          <div className="px-2 mb-2">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Recent Chats</span>
          </div>
          <div className="space-y-0.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1 text-xs">
            {recentChats.map((chat, i) => (
              <button
                key={i}
                className="w-full text-left px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 truncate transition-all"
              >
                {chat}
              </button>
            ))}
          </div>
        </div>

        {/* Profile Footer */}
        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center text-slate-700 text-xs font-semibold">
              .9
            </div>
            <div>
              <p className="text-xs font-medium text-slate-900 leading-none">@leo</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-none">Free Plan</p>
            </div>
          </div>
          <button className="text-slate-400 hover:text-slate-700 p-1">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col justify-between bg-white relative overflow-hidden">
        {/* Top Header */}
        <header className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="relative">
            <button className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-slate-900">
              <span>{selectedModel}</span>
              <ChevronDown className="w-4 h-4 text-slate-500" />
            </button>
          </div>
          <button className="text-slate-400 hover:text-slate-700 p-1 rounded-md">
            <Sun className="w-4 h-4" />
          </button>
        </header>

        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full space-y-8">
          {messages.map((m) => (
            <div key={m.id} className="space-y-3">
              {m.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="bg-[#f2f2f4] text-slate-900 text-sm px-4 py-2.5 rounded-2xl max-w-lg">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-slate-800 text-sm leading-relaxed">
                  <div className="whitespace-pre-wrap">{m.content}</div>

                  <div className="flex items-center gap-3 pt-1 text-slate-400">
                    <button
                      onClick={() => handleCopy(m.id, m.content)}
                      className="hover:text-slate-600 transition-colors"
                      title="Copy"
                    >
                      {copiedId === m.id ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                    <button className="hover:text-slate-600 transition-colors" title="Share">
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button className="hover:text-slate-600 transition-colors" title="Regenerate">
                      <RotateCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Action Chips & Input Area */}
        <div className="max-w-3xl mx-auto w-full px-6 pb-4 pt-2">
          <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
            <button
              onClick={() => handleQuickAction('Write code for')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Write code</span>
            </button>
            <button
              onClick={() => handleQuickAction('Summarize this text:')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Summarize this</span>
            </button>
            <button
              onClick={() => handleQuickAction('Make a detailed plan for')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <ListTodo className="w-3.5 h-3.5" />
              <span>Make a plan</span>
            </button>
            <button
              onClick={() => handleQuickAction('Improve and refine this text:')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Improve text</span>
            </button>
            <button
              onClick={() => handleQuickAction('Research and analyze')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Research this</span>
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 bg-[#f4f4f6] rounded-full px-4 py-2 border border-slate-200/60 focus-within:border-slate-300 shadow-sm"
          >
            <button type="button" className="text-slate-500 hover:text-slate-800 p-1">
              <Plus className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message NEO..."
              className="flex-1 bg-transparent border-none text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
            />
            <button type="button" className="text-slate-500 hover:text-slate-800 p-1">
              <Mic className="w-4 h-4" />
            </button>
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-black disabled:opacity-40 transition-all shadow"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>

          <p className="text-[11px] text-slate-400 text-center mt-2">
            NEO may produce inaccurate info. Verify critical data.
          </p>
        </div>
      </main>
    </div>
  );
}
