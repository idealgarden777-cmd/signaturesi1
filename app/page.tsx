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
  X
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
  updatedAt: string;
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string>('default-thread');
  const [conversations, setConversations] = useState<ConversationThread[]>([
    {
      id: 'default-thread',
      title: 'Explain quantum computing',
      updatedAt: 'Just now',
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Explain quantum computing in simple terms.'
        },
        {
          id: '2',
          role: 'assistant',
          content: `Quantum computing ka basic concept **bits** aur **qubits** ka farq hai. Normal computers mein data bits (0 ya 1) mein store hota hai, lekin quantum computers mein qubits hote hain jo ek hi waqt mein 0 aur 1 dono states mein reh sakte hain. Is phenomenon ko **superposition** kehte hain.\n\nIska asli fayda **entanglement** se milta hai, jahan qubits aapas mein is tarah jud jaate hain ke ek ki state dusre ko instant affect karti hai, chahe wo kitni hi door kyun na ho. Iski wajah se quantum computers complex problems ko parallel process kar sakte hain, jo aaj ke supercomputers ke liye solve karna namumkin hai.\n\nSocho ke agar tumhein ek maze (bhal bhulaiya) se bahar nikalna ho, toh normal computer har rasta ek-ek karke check karega. Quantum computer saare raaste ek saath check kar sakta hai aur seedha exit dhoond lega. Ye technology abhi apne shuruati daur mein hai, lekin future mein ye medicine, encryption aur material science mein revolutionary changes la sakti hai.`
        }
      ]
    }
  ]);

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'deepseek-v4-flash' | 'gemini-3.1-flash-lite'>('deepseek-v4-flash');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentArtifactCode, setCurrentArtifactCode] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = conversations.find((c) => c.id === activeThreadId) || conversations[0];
  const messages = activeThread?.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

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
      updatedAt: 'Just now'
    };
    setConversations([newThread, ...conversations]);
    setActiveThreadId(newId);
    setCurrentArtifactCode('');
  };

  const handleSelectThread = (id: string) => {
    setActiveThreadId(id);
    setCurrentArtifactCode('');
  };

  const handleQuickAction = (actionText: string) => {
    setInput(actionText + ' ');
  };

  const handleRegenerate = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && !isStreaming) {
      executeStreamingRequest(lastUserMsg.content, messages.filter((m) => m.id !== messages[messages.length - 1]?.id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    executeStreamingRequest(input.trim(), messages);
  };

  const executeStreamingRequest = async (userPrompt: string, baseMessages: ChatMessage[]) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userPrompt
    };

    const updatedMessages = [...baseMessages, userMsg];
    
    setConversations((prev) =>
      prev.map((thread) => {
        if (thread.id === activeThreadId) {
          return {
            ...thread,
            title: thread.title === 'New Conversation' ? userPrompt.slice(0, 28) + '...' : thread.title,
            messages: updatedMessages,
            updatedAt: 'Just now'
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
    <div className="flex h-screen bg-[#fcfcfc] text-slate-800 font-sans antialiased overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-64 bg-[#f4f4f6] border-r border-slate-200/80 flex flex-col justify-between p-3 select-none transition-all">
          <div>
            <div className="flex items-center justify-between px-2 py-1 mb-4">
              <div>
                <h1 className="font-bold text-sm text-slate-900 tracking-tight">NEO Engine</h1>
                <p className="text-[11px] text-slate-500">Signaturesi Central</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition-colors"
                title="Collapse Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1 mb-6">
              <button
                onClick={handleNewConversation}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all"
              >
                <Edit3 className="w-4 h-4 text-slate-600" />
                <span>New Conversation</span>
              </button>
              <button className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-200/60 rounded-lg transition-all">
                <Sparkles className="w-4 h-4 text-slate-600" />
                <span>NEO Personalities</span>
              </button>
            </div>

            <div className="px-2 mb-2">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Recent Chats</span>
            </div>
            <div className="space-y-0.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1 text-xs">
              {conversations.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => handleSelectThread(thread.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-md truncate transition-all ${
                    thread.id === activeThreadId
                      ? 'bg-slate-200/80 text-slate-900 font-medium'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  {thread.title}
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

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col justify-between bg-white relative overflow-hidden">
        <header className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
                title="Open Sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-slate-900 bg-slate-100/60 px-3 py-1.5 rounded-lg transition-all"
              >
                <span>{selectedModel === 'deepseek-v4-flash' ? 'NEO L1.0 (DeepSeek V4-Flash)' : 'Gemini 3.1 Flash Lite'}</span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </button>

              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1">
                  <button
                    onClick={() => {
                      setSelectedModel('deepseek-v4-flash');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedModel === 'deepseek-v4-flash' ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    NEO L1.0 (DeepSeek V4-Flash)
                  </button>
                  <button
                    onClick={() => {
                      setSelectedModel('gemini-3.1-flash-lite');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      selectedModel === 'gemini-3.1-flash-lite' ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Gemini 3.1 Flash Lite
                  </button>
                </div>
              )}
            </div>
          </div>

          <button className="text-slate-400 hover:text-slate-700 p-1 rounded-md">
            <Sun className="w-4 h-4" />
          </button>
        </header>

        {/* Chat Feed */}
        <div className="flex-1 overflow-y-auto px-6 py-8 max-w-3xl mx-auto w-full space-y-8">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 my-auto">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
                <Sparkles className="w-6 h-6 text-purple-600" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 mb-1">What can I help with today?</h2>
              <p className="text-xs text-slate-500 max-w-sm">
                Ask NEO anything, generate code components, or run deep research analysis.
              </p>
            </div>
          ) : (
            messages.map((m) => (
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
                      <button
                        onClick={handleRegenerate}
                        disabled={isStreaming}
                        className="hover:text-slate-600 transition-colors disabled:opacity-40"
                        title="Regenerate"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Action Chips & Input */}
        <div className="max-w-3xl mx-auto w-full px-6 pb-4 pt-2">
          <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
            <button
              onClick={() => handleQuickAction('Write code for')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <Code className="w-3.5 h-3.5" />
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
              <FileText className="w-3.5 h-3.5" />
              <span>Make a plan</span>
            </button>
            <button
              onClick={() => handleQuickAction('Improve and refine this text:')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f4f4f6] hover:bg-slate-200/80 text-slate-700 text-xs font-medium rounded-full transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
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

      {/* Live Artifact Sandbox Drawer */}
      {currentArtifactCode && (
        <aside className="w-[45%] min-w-[360px] p-4 bg-slate-950 border-l border-slate-800/80 hidden lg:flex flex-col relative">
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
