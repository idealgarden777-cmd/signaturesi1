'use client';

import { useState, useRef, useEffect } from 'react';
import ArtifactPanel from '@/components/ArtifactPanel';
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
  Edit3,
  Code,
  FileText,
  Search,
  Check,
  PanelLeftClose,
  PanelLeft,
  X,
  Code2,
  Cpu,
  Lightbulb,
  MailCheck
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default function Home() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'l1.0' | 'l1.2'>('l1.0');
  const [modelMenuOpen, setModelDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentArtifactCode, setCurrentArtifactCode] = useState('');

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
  }, [messages, isStreaming]);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.body.classList.toggle('dark-mode', !darkMode);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const handlePromptClick = (promptText: string) => {
    setInput(promptText);
  };

  const handleNewConversation = () => {
    setMessages([]);
    setInput('');
    setCurrentArtifactCode('');
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

    setRecentChats((prev) => [userPrompt.slice(0, 28) + '...', ...prev]);

    try {
      const res = await fetch('/api/neo/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          selectedModel: selectedModel === 'l1.2' ? 'deepseek-v4-flash' : 'gemini-3.1-flash-lite'
        }),
      });

      if (!res.ok) throw new Error('API Request Failed');

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

                  if (assistantContent.includes('```html') || assistantContent.includes('```HTML')) {
                    const match = /```html([\s\S]*?)```/i.exec(assistantContent);
                    if (match) {
                      const codeText = match.pop();
                      if (codeText) {
                        setCurrentArtifactCode(codeText.trim());
                      }
                    }
                  }

                  const assistantMsg: ChatMessage = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: assistantContent
                  };

                  const filtered = updatedMessages.filter((m) => m.id !== assistantMsgId);
                  setMessages([...filtered, assistantMsg]);
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
    <div className={`flex h-screen w-full bg-[#fcfcfc] text-slate-800 font-sans antialiased overflow-hidden ${darkMode ? 'dark-mode' : ''}`}>
      {/* Sidebar */}
      {!sidebarCollapsed && (
        <aside className="w-64 bg-[#f4f4f6] border-r border-slate-200/80 flex flex-col justify-between p-3 select-none shrink-0 h-full">
          <div>
            <div className="flex items-center justify-between px-2 py-1 mb-4">
              <div>
                <h1 className="font-bold text-sm text-slate-900 tracking-tight">NEO Engine</h1>
                <p className="text-[11px] text-slate-500">Signaturesi Central</p>
              </div>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition-colors"
                title="Collapse Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 mb-6">
              <button onClick={handleNewConversation} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all text-left">
                <Edit3 className="w-4 h-4 text-slate-600" />
                <span>New Conversation</span>
              </button>
              <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all text-left">
                <Sparkles className="w-4 h-4 text-slate-600" />
                <span>NEO Personalities</span>
              </button>
            </div>

            <div className="px-2 mb-2">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Recent Chats</span>
            </div>
            <div className="space-y-0.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1 text-xs">
              {recentChats.map((chat, i) => (
                <button key={i} className="w-full text-left px-2.5 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 truncate transition-all">
                  {chat}
                </button>
              ))}
            </div>
          </div>

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
      )}

      {/* Main App Workspace Area */}
      <main className="flex-1 flex flex-col justify-between bg-white relative h-full overflow-hidden">
        <header className="px-6 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
                title="Open Sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setModelDropdownOpen(!modelMenuOpen)}
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-slate-900 bg-slate-100/60 px-3 py-1.5 rounded-lg transition-all"
              >
                <span>{selectedModel === 'l1.0' ? 'NEO L1.0' : 'NEO L1.2 Pro'}</span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </button>

              {modelMenuOpen && (
                <div className="absolute top-full left-0 mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1">
                  <button
                    onClick={() => {
                      setSelectedModel('l1.0');
                      setModelDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedModel === 'l1.0' ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    NEO L1.0
                  </button>
                  <button
                    onClick={() => {
                      setSelectedModel('l1.2');
                      setModelDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedModel === 'l1.2' ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    NEO L1.2 Pro
                  </button>
                </div>
              )}
            </div>
          </div>

          <button onClick={toggleDarkMode} className="text-slate-400 hover:text-slate-700 p-1 rounded-md">
            <Sun className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-8 pb-32 max-w-3xl mx-auto w-full">
          {messages.length === 0 ? (
            <div className="hero-section">
              <h1 className="text-2xl font-semibold text-slate-900 mb-2">What can I help with today?</h1>
              <p className="text-xs text-slate-500 mb-8">Powered by NEO Engine. Select a prompt or type your message below.</p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <button
                  onClick={() => handlePromptClick('Write a Python script to scrape website data cleanly.')}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 text-xs font-medium text-slate-800 transition-all"
                >
                  <Code2 className="w-4 h-4 text-slate-500" />
                  <span>Python Scraper</span>
                </button>
                <button
                  onClick={() => handlePromptClick('Explain quantum computing in simple terms.')}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 text-xs font-medium text-slate-800 transition-all"
                >
                  <Cpu className="w-4 h-4 text-slate-500" />
                  <span>Quantum Computing</span>
                </button>
                <button
                  onClick={() => handlePromptClick('Help me outline a business plan for a new SaaS product.')}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 text-xs font-medium text-slate-800 transition-all"
                >
                  <Lightbulb className="w-4 h-4 text-slate-500" />
                  <span>SaaS Business Plan</span>
                </button>
                <button
                  onClick={() => handlePromptClick('Draft a professional partnership proposal email.')}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 text-xs font-medium text-slate-800 transition-all"
                >
                  <MailCheck className="w-4 h-4 text-slate-500" />
                  <span>Draft Partnership Email</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
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
                        <button onClick={() => handleCopy(m.id, m.content)} className="hover:text-slate-600">
                          {copiedId === m.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button className="hover:text-slate-600"><Share2 className="w-4 h-4" /></button>
                        <button className="hover:text-slate-600"><RotateCw className="w-4 h-4" /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar Fixed at Bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none">
          <div className="max-w-3xl mx-auto w-full pointer-events-auto space-y-2">
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 bg-[#f4f4f6] rounded-full px-4 py-2 border border-slate-200/80 focus-within:border-slate-300 shadow-sm"
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
            <p className="text-[11px] text-slate-400 text-center">
              NEO may produce inaccurate info. Verify critical data.
            </p>
          </div>
        </div>
      </main>

      {/* Live Artifact Sandbox Drawer */}
      {currentArtifactCode && (
        <aside className="w-[45%] min-w-[360px] p-4 bg-slate-950 border-l border-slate-800/80 hidden lg:flex flex-col relative shrink-0">
          <button
            onClick={() => setCurrentArtifactCode('')}
            className="absolute top-2 right-2 text-slate-400 hover:text-white p-1 z-10"
            title="Close Sandbox"
          >
            <X className="w-4 h-4" />
          </button>
          <ArtifactPanel code={currentArtifactCode} />
        </aside>
      )}
    </div>
  );
}
