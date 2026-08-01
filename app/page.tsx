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
  Trash2,
  MessageSquare,
  Wand2,
  ListTodo,
  Cpu,
  Brain
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'deepseek-v4-flash' | 'gemini-3.1-flash-lite'>('deepseek-v4-flash');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Persistent Conversation State
  const [conversations, setConversations] = useState<ConversationThread[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('neo_conversations');
      if (saved) {
        try { return JSON.parse(saved); } catch {}
      }
    }
    return [
      {
        id: 'default-1',
        title: 'Explain Quantum Computing',
        updatedAt: 'Just now',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Explain quantum computing in simple terms.',
            timestamp: '12:00 PM'
          },
          {
            id: 'm2',
            role: 'assistant',
            content: `Quantum computing ka basic concept **bits** aur **qubits** ka farq hai. Normal computers mein data bits (0 ya 1) mein store hota hai, lekin quantum computers mein qubits hote hain jo ek hi waqt mein 0 aur 1 dono states mein reh sakte hain (**superposition**).\n\nIska asli fayda **entanglement** se milta hai, jahan qubits aapas mein jud kar complex calculations parallel process kar sakte hain.`,
            timestamp: '12:00 PM'
          }
        ]
      }
    ];
  });

  const [activeThreadId, setActiveThreadId] = useState<string>(() => conversations[0]?.id || 'default-1');
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentArtifactCode, setCurrentArtifactCode] = useState('');
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeThread = conversations.find((c) => c.id === activeThreadId) || conversations[0];
  const messages = activeThread?.messages || [];

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('neo_conversations', JSON.stringify(conversations));
    }
  }, [conversations]);

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

  const handleNewConversation = () => {
    const newId = crypto.randomUUID();
    const newThread: ConversationThread = {
      id: newId,
      title: 'New Conversation',
      messages: [],
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
      if (activeThreadId === id) {
        setActiveThreadId(filtered[0].id);
      }
    }
  };

  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? prev + ' ' + transcript : transcript));
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userPrompt = input.trim();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userPrompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedMessages = [...messages, userMsg];

    setConversations((prev) =>
      prev.map((thread) => {
        if (thread.id === activeThreadId) {
          return {
            ...thread,
            title: thread.messages.length === 0 ? userPrompt.slice(0, 26) + '...' : thread.title,
            messages: updatedMessages,
            updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
          selectedModel
        }),
      });

      if (!res.ok) throw new Error('Failed to stream response');

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

                  // Parse code blocks safely
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
                    content: assistantContent,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  };

                  setConversations((prev) =>
                    prev.map((thread) => {
                      if (thread.id === activeThreadId) {
                        const filtered = thread.messages.filter((m) => m.id !== assistantMsgId);
                        return {
                          ...thread,
                          messages: [...filtered, assistantMsg]
                        };
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
    <div className={`flex h-screen w-full bg-[#fcfcfc] text-slate-800 font-sans antialiased overflow-hidden ${darkMode ? 'dark-mode' : ''}`}>
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-72 bg-[#f4f4f6] border-r border-slate-200/80 flex flex-col justify-between p-3 select-none shrink-0 h-full">
          <div>
            <div className="flex items-center justify-between px-2 py-1 mb-4">
              <div>
                <h1 className="font-bold text-sm text-slate-900 tracking-tight">NEO Engine</h1>
                <p className="text-[11px] text-slate-500">Signaturesi Central</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors"
                title="Collapse Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 mb-6">
              <button
                onClick={handleNewConversation}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-200/80 rounded-xl transition-all shadow-sm bg-white/60 border border-slate-200/60"
              >
                <Edit3 className="w-4 h-4 text-purple-600" />
                <span>New Conversation</span>
              </button>
            </div>

            <div className="px-2 mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Recent Chats</span>
              <span className="text-[10px] text-slate-400">{conversations.length}</span>
            </div>

            <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto pr-1 text-xs">
              {conversations.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all ${
                    thread.id === activeThreadId
                      ? 'bg-slate-200/90 text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{thread.title}</span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(thread.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 p-1 transition-all"
                    title="Delete Chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between px-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 text-white flex items-center justify-center font-semibold text-xs shadow-sm">
                S
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-900 leading-none">samuel yousaf</p>
                <p className="text-[10px] text-purple-600 font-medium mt-1 leading-none">Free Plan</p>
              </div>
            </div>
            <button className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200/60">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col justify-between bg-white relative h-full overflow-hidden">
        <header className="px-6 py-3 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                title="Open Sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-800 bg-slate-100/80 hover:bg-slate-200/60 px-3.5 py-2 rounded-xl transition-all border border-slate-200/60 shadow-xs"
              >
                <Brain className="w-3.5 h-3.5 text-purple-600" />
                <span>{selectedModel === 'deepseek-v4-flash' ? 'NEO L1.0 (DeepSeek V4-Flash)' : 'Gemini 3.1 Flash Lite'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-1.5 space-y-1">
                  <button
                    onClick={() => {
                      setSelectedModel('deepseek-v4-flash');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                      selectedModel === 'deepseek-v4-flash'
                        ? 'bg-purple-50 text-purple-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    NEO L1.0 (DeepSeek V4-Flash)
                  </button>
                  <button
                    onClick={() => {
                      setSelectedModel('gemini-3.1-flash-lite');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                      selectedModel === 'gemini-3.1-flash-lite'
                        ? 'bg-purple-50 text-purple-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Gemini 3.1 Flash Lite
                  </button>
                </div>
              )}
            </div>
          </div>

          <button onClick={toggleDarkMode} className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <Sun className="w-4 h-4" />
          </button>
        </header>

        {/* Scrollable Conversation Content */}
        <div className="flex-1 overflow-y-auto px-6 py-8 pb-32 max-w-3xl mx-auto w-full">
          {messages.length === 0 ? (
            <div className="hero-section text-center my-auto py-12">
              <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center mx-auto mb-4 shadow-xs">
                <Sparkles className="w-6 h-6 text-purple-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 mb-1">What can I help with today?</h1>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-8">
                Powered by NEO Engine. Select a prompt or type your message below.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-[#f2f2f4] text-slate-900 text-sm px-4 py-2.5 rounded-2xl max-w-lg shadow-xs">
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
                          title="Copy text"
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
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar Dock Fixed at Bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none">
          <div className="max-w-3xl mx-auto w-full pointer-events-auto space-y-2">
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 bg-[#f4f4f6] rounded-full px-4 py-2 border border-slate-200/80 focus-within:border-purple-300 focus-within:shadow-md transition-all shadow-xs"
            >
              <button type="button" className="text-slate-400 hover:text-slate-700 p-1">
                <Plus className="w-4 h-4" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message NEO..."
                className="flex-1 bg-transparent border-none text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleVoiceInput}
                className={`p-1.5 rounded-full transition-all ${
                  isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-slate-700'
                }`}
                title={isListening ? 'Listening...' : 'Voice Input'}
              >
                <Mic className="w-4 h-4" />
              </button>
              <button
                type="submit"
                disabled={!input.trim() || isStreaming}
                className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-black disabled:opacity-40 transition-all shadow-xs"
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
