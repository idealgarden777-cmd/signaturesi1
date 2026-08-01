'use client';

import { useState, useRef, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import ArtifactPanel from '@/components/ArtifactPanel';
import {
  Plus,
  Sparkles,
  ChevronDown,
  Sun,
  Moon,
  Copy,
  Share2,
  RotateCw,
  Mic,
  ArrowUp,
  Settings,
  Edit3,
  Code2,
  Cpu,
  Lightbulb,
  MailCheck,
  PanelLeftClose,
  PanelLeft,
  X,
  Trash2,
  MessageSquare,
  Check,
  LogOut,
  Columns2,
  SquarePen
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export default function Home() {
  const [supabase] = useState(() => createBrowserSupabaseClient());
  const [userSession, setUserSession] = useState<any>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'l1.0' | 'l1.2'>('l1.0');
  const [modelMenuOpen, setModelDropdownOpen] = useState(false);
  
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentArtifactCode, setCurrentArtifactCode] = useState('');

  const [conversations, setConversations] = useState<ConversationThread[]>([
    {
      id: 'c1',
      title: 'Explain Quantum Computing',
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Explain quantum computing in simple terms.'
        },
        {
          id: '2',
          role: 'assistant',
          content: `To understand quantum computing, you first need to understand how a normal computer works.\n\n### 1. The Classical Computer (The Light Switch)\nYour laptop, smartphone, and even NASA operate using **bits**. Think of a bit like a light switch: it is either **ON (1)** or **OFF (0)**.\n\n### 2. The Quantum Computer (The Spinning Coin)\nA quantum computer uses **qubits** (quantum bits). Instead of being stuck as a 0 or a 1, a qubit can exist in a state called **superposition**.\n\nImagine a coin: A classical bit is the coin lying flat. A qubit is the coin **spinning on the table**.`
        }
      ]
    }
  ]);

  const [activeThreadId, setActiveThreadId] = useState<string>('c1');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) setUserSession(data.user);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserSession(session?.user || null);
    });

    return () => { authListener.subscription.unsubscribe(); };
  }, [supabase]);

  const activeThread = conversations.find((c) => c.id === activeThreadId) || conversations[0];
  const activeMessages = activeThread?.messages || messages;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, isStreaming]);

  const toggleDarkMode = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    document.body.classList.toggle('dark-mode', nextDark);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const handleNewConversation = () => {
    const newId = crypto.randomUUID();
    const newThread: ConversationThread = {
      id: newId,
      title: 'New Conversation',
      messages: []
    };
    setConversations([newThread, ...conversations]);
    setActiveThreadId(newId);
    setCurrentArtifactCode('');
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = conversations.filter((c) => c.id !== id);
    if (filtered.length === 0) {
      handleNewConversation();
    } else {
      setConversations(filtered);
      if (activeThreadId === id) setActiveThreadId(filtered[0].id);
    }
  };

  const handlePromptClick = (promptText: string) => {
    setInput(promptText);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUserSession(null);
    setUserMenuOpen(false);
  };

  const renderFormattedText = (content: string) => {
    let formatted = content
      .replace(/### (.*?)\n/g, '<h3 className="font-bold text-base my-2 text-slate-900 dark:text-slate-100">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong className="font-semibold text-slate-900 dark:text-slate-100">$1</strong>')
      .replace(/\n/g, '<br/>');

    return <div className="markdown-body leading-relaxed text-slate-800 dark:text-slate-200" dangerouslySetInnerHTML={{ __html: formatted }} />;
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

    const updatedMessages = [...activeMessages, userMsg];

    setConversations((prev) =>
      prev.map((thread) => {
        if (thread.id === activeThreadId) {
          return {
            ...thread,
            title: thread.messages.length === 0 ? userPrompt.slice(0, 26) + '...' : thread.title,
            messages: updatedMessages
          };
        }
        return thread;
      })
    );

    setInput('');
    setIsStreaming(true);

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
                      if (codeText) setCurrentArtifactCode(codeText.trim());
                    }
                  }

                  const assistantMsg: ChatMessage = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: assistantContent
                  };

                  setConversations((prev) =>
                    prev.map((thread) => {
                      if (thread.id === activeThreadId) {
                        const filtered = thread.messages.filter((m) => m.id !== assistantMsgId);
                        return { ...thread, messages: [...filtered, assistantMsg] };
                      }
                      return thread;
                    })
                  );
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
    <div className={`flex h-screen w-screen overflow-hidden ${darkMode ? 'dark-mode bg-[#212121] text-[#ececec]' : 'bg-white text-[#0d0d0d]'}`}>
      {/* Sidebar */}
      <aside className={`w-[288px] min-w-[288px] max-w-[288px] flex flex-col justify-between p-3 select-none h-full transition-all border-r ${
        darkMode ? 'bg-[#171717] border-[#2e2e2e]' : 'bg-[#f9f9f9] border-[#e5e5ea]'
      } ${sidebarCollapsed ? '-ml-[288px]' : ''}`}>
        <div>
          {/* Header */}
          <div className="flex items-center justify-between px-2 py-1 mb-4">
            <div>
              <h1 className="font-semibold text-sm tracking-tight">NEO Engine</h1>
              <p className="text-[11px] text-slate-500">Signaturesi Central</p>
            </div>
            <button onClick={() => setSidebarCollapsed(true)} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800">
              <PanelLeftClose size={18} />
            </button>
          </div>

          {/* Primary Nav */}
          <div className="space-y-1 mb-6">
            <button onClick={handleNewConversation} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 transition-all text-left">
              <Edit3 size={16} />
              <span>New Conversation</span>
            </button>
            <button onClick={() => { setActiveSettingsTab('personalities'); setSettingsOpen(true); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 transition-all text-left">
              <Sparkles size={16} />
              <span>NEO Personalities</span>
            </button>
          </div>

          {/* Recent Chats */}
          <div className="px-2 mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Recent Chats</span>
          </div>

          <div className="space-y-0.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1 text-xs">
            {conversations.map((thread) => (
              <div
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all ${
                  thread.id === activeThreadId ? (darkMode ? 'bg-[#2f2f2f] font-semibold' : 'bg-[#e8e8ed] font-semibold') : 'hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <MessageSquare size={14} className="text-slate-400 shrink-0" />
                  <span className="truncate">{thread.title}</span>
                </div>
                <button onClick={(e) => handleDeleteConversation(thread.id, e)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 p-1">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* User Profile Footer */}
        <div className="relative border-t pt-2 border-slate-200 dark:border-[#2e2e2e]">
          {userMenuOpen && (
            <div className="absolute bottom-16 left-0 w-full p-2 bg-white dark:bg-[#212121] border border-slate-200 dark:border-[#2e2e2e] rounded-2xl shadow-xl z-50 space-y-1">
              <button onClick={() => { setSettingsOpen(true); setUserMenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
                <Settings size={15} /> Settings
              </button>
              <button onClick={toggleDarkMode} className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800">
                {darkMode ? <Sun size={15} /> : <Moon size={15} />} Appearance
              </button>
              <div className="border-t border-slate-200 dark:border-slate-800 my-1"></div>
              <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30">
                <LogOut size={15} /> Log out
              </button>
            </div>
          )}

          <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 transition-all text-left">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">
                {userSession?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <p className="text-xs font-semibold leading-none truncate max-w-[130px]">{userSession?.email?.split('@')[0] || '@user'}</p>
                <p className="text-[10px] text-slate-500 mt-1 leading-none">{userSession ? 'Authenticated' : 'Free Plan'}</p>
              </div>
            </div>
            <Settings size={16} className="text-slate-400" />
          </button>
        </div>
      </aside>

      {/* Main Workspace (Full Width) */}
      <main className="flex-1 flex flex-col justify-between relative h-full w-full overflow-hidden">
        {/* Top Header */}
        <header className="h-13 px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-[#2e2e2e]">
          <div className="flex items-center gap-3">
            {sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <PanelLeft size={18} />
              </button>
            )}

            {/* Absolute Positioned Model Dropdown */}
            <div className="relative">
              <button onClick={() => setModelDropdownOpen(!modelMenuOpen)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">
                <span>{selectedModel === 'l1.0' ? 'NEO L1.0' : 'NEO L1.2 Pro'}</span>
                <ChevronDown size={16} className="text-slate-400" />
              </button>

              {modelMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 p-2 bg-white dark:bg-[#212121] border border-slate-200 dark:border-[#2e2e2e] rounded-2xl shadow-xl z-50 space-y-1">
                  <div onClick={() => { setSelectedModel('l1.0'); setModelDropdownOpen(false); }} className={`p-2.5 rounded-xl cursor-pointer text-xs ${selectedModel === 'l1.0' ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 font-semibold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                    <strong className="block font-semibold">NEO L1.0</strong>
                    <span className="text-[11px] text-slate-500">Text & Images • Fast Responses</span>
                  </div>
                  <div onClick={() => { setSelectedModel('l1.2'); setModelDropdownOpen(false); }} className={`p-2.5 rounded-xl cursor-pointer text-xs ${selectedModel === 'l1.2' ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 font-semibold' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                    <div className="flex items-center justify-between">
                      <strong className="font-semibold">NEO L1.2 Pro</strong>
                      <span className="text-[10px] bg-purple-600 text-white font-bold px-1.5 py-0.5 rounded-md">PRO</span>
                    </div>
                    <span className="text-[11px] text-slate-500">Deep Reasoning & Multimodal</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button onClick={toggleDarkMode} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {/* Scrollable Conversation (Centered 768px Column) */}
        <div className="flex-1 overflow-y-auto px-6 py-8 pb-32 max-w-3xl mx-auto w-full">
          {activeMessages.length === 0 ? (
            <div className="text-center my-auto py-12">
              <h1 className="text-2xl font-bold mb-2">What can I help with today?</h1>
              <p className="text-xs text-slate-500 mb-8">Powered by NEO Engine. Select a prompt or type below.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <button onClick={() => handlePromptClick('Write a Python script to scrape website data cleanly.')} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium transition-all flex items-center gap-2">
                  <Code2 size={16} className="text-purple-500" /> Python Scraper
                </button>
                <button onClick={() => handlePromptClick('Explain quantum computing in simple terms.')} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium transition-all flex items-center gap-2">
                  <Cpu size={16} className="text-purple-500" /> Quantum Computing
                </button>
                <button onClick={() => handlePromptClick('Help me outline a business plan for a new SaaS product.')} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium transition-all flex items-center gap-2">
                  <Lightbulb size={16} className="text-purple-500" /> SaaS Business Plan
                </button>
                <button onClick={() => handlePromptClick('Draft a professional partnership proposal email.')} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-medium transition-all flex items-center gap-2">
                  <MailCheck size={16} className="text-purple-500" /> Draft Partnership Email
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {activeMessages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-[#f4f4f6] dark:bg-[#2f2f2f] text-sm px-4 py-2.5 rounded-2xl max-w-lg">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm leading-relaxed">
                      {renderFormattedText(m.content)}
                      <div className="flex items-center gap-3 pt-2 text-slate-400">
                        <button onClick={() => handleCopy(m.id, m.content)} className="p-1 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" title="Copy">
                          {copiedId === m.id ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                        </button>
                        <button className="p-1 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" title="Share"><Share2 size={16} /></button>
                        <button className="p-1 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" title="Regenerate"><RotateCw size={16} /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer Dock - Horizontally Aligned Input Bar */}
        <footer className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-white dark:from-[#212121] via-white/90 dark:via-[#212121]/90 to-transparent">
          <div className="max-w-3xl mx-auto w-full space-y-2">
            <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-[#f9f9f9] dark:bg-[#171717] rounded-full px-4 py-2 border border-slate-200 dark:border-[#2e2e2e] shadow-sm">
              <button type="button" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 shrink-0">
                <Plus size={18} />
              </button>
              
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                placeholder="Message NEO..."
                rows={1}
                className="flex-1 bg-transparent border-none text-sm focus:outline-none resize-none pt-1"
              />

              <div className="flex items-center gap-1.5 shrink-0">
                <button type="button" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1">
                  <Mic size={18} />
                </button>
                <button type="submit" disabled={!input.trim() || isStreaming} className="w-8 h-8 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center disabled:opacity-40 shadow shrink-0">
                  <ArrowUp size={16} />
                </button>
              </div>
            </form>
            <p className="text-[11px] text-slate-400 text-center">NEO may produce inaccurate info. Verify critical data.</p>
          </div>
        </footer>
      </main>

      {/* Artifact Panel Drawer */}
      {Boolean(currentArtifactCode && currentArtifactCode.trim().length > 0) && (
        <aside className="w-[45%] min-w-[360px] p-4 bg-slate-950 border-l border-slate-800 hidden lg:flex flex-col relative shrink-0">
          <button onClick={() => setCurrentArtifactCode('')} className="absolute top-2 right-2 text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
          <ArtifactPanel code={currentArtifactCode} />
        </aside>
      )}

      {/* Settings Overlay Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#212121] border border-slate-200 dark:border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl flex h-[500px]">
            <aside className="w-48 bg-slate-50 dark:bg-[#171717] p-3 border-r border-slate-200 dark:border-[#2e2e2e] space-y-1">
              <button onClick={() => setSettingsOpen(false)} className="p-1 mb-2 text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
              <button onClick={() => setActiveSettingsTab('general')} className={`w-full text-left px-3 py-2 text-xs rounded-xl font-medium ${activeSettingsTab === 'general' ? 'bg-slate-200 dark:bg-[#2f2f2f] font-semibold' : ''}`}>
                General
              </button>
              <button onClick={() => setActiveSettingsTab('personalities')} className={`w-full text-left px-3 py-2 text-xs rounded-xl font-medium ${activeSettingsTab === 'personalities' ? 'bg-slate-200 dark:bg-[#2f2f2f] font-semibold' : ''}`}>
                NEO Personalities
              </button>
            </aside>
            <main className="flex-1 p-6 overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">Settings</h2>
              {activeSettingsTab === 'general' && (
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                    <div><strong>Appearance</strong><p className="text-slate-500">Toggle light or dark mode theme.</p></div>
                    <button onClick={toggleDarkMode} className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg">{darkMode ? 'Dark' : 'Light'}</button>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
