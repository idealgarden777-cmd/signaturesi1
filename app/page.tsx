'use client';

import { useState, useRef, useEffect } from 'react';
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
  Check,
  MessageSquare
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'l1.0' | 'l1.2'>('l1.0');
  const [modelMenuOpen, setModelDropdownOpen] = useState(false);

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
      content: `Quantum computing ka basic concept **bits** aur **qubits** ka farq hai. Normal computers mein data bits (0 ya 1) mein store hota hai, lekin quantum computers mein qubits hote hain jo ek hi waqt mein 0 aur 1 dono states mein reh sakte hain (**superposition**).\n\nIska asli fayda **entanglement** se milta hai, jahan qubits aapas mein jud kar complex calculations parallel process kar sakte hain.`
    }
  ]);

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
          content: `Quantum computing ka basic concept **bits** aur **qubits** ka farq hai. Normal computers mein data bits (0 ya 1) mein store hota hai, lekin quantum computers mein qubits hote hain jo ek hi waqt mein 0 aur 1 dono states mein reh sakte hain (**superposition**).\n\nIska asli fayda **entanglement** se milta hai, jahan qubits aapas mein jud kar complex calculations parallel process kar sakte hain.`
        }
      ]
    }
  ]);

  const [activeThreadId, setActiveThreadId] = useState<string>('c1');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const renderFormattedText = (content: string) => {
    let formatted = content
      .replace(/### (.*?)\n/g, '<h3 className="font-bold text-base my-2">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');

    return <div className="markdown-body leading-relaxed" dangerouslySetInnerHTML={{ __html: formatted }} />;
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
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} id="sidebar">
        <div className="sidebar-header">
          <button className="brand-button" id="brandBtn" type="button">
            <span className="brand-copy">
              <strong>NEO Engine</strong>
              <small>Signaturesi Central</small>
            </span>
          </button>
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="icon-btn"
            id="collapseSidebarBtn"
            title="Close Sidebar"
            type="button"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div className="sidebar-content">
          <nav className="sidebar-primary-nav" aria-label="Primary navigation">
            <button onClick={handleNewConversation} className="new-chat-btn" id="newChatBtn" type="button" title="New conversation">
              <Edit3 className="w-4 h-4 text-purple-500" />
              <span>New Conversation</span>
            </button>
            <button className="sidebar-personality-btn" id="sidebarPersonalitiesBtn" type="button" title="NEO Personalities">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <span>NEO Personalities</span>
            </button>
          </nav>

          <div className="history-section">
            <span className="section-title">RECENT CHATS</span>
            <div className="history-list" id="historyList">
              {conversations.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`history-item-wrapper ${thread.id === activeThreadId ? 'active' : ''}`}
                >
                  <button className="history-item">
                    {thread.title}
                  </button>
                  <button
                    onClick={(e) => handleDeleteConversation(thread.id, e)}
                    className="icon-btn hover:text-red-500"
                    title="Delete Chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="user-profile-btn" id="userProfileBtn" type="button">
            <div id="userAvatar">U</div>
            <div className="user-info">
              <span className="user-name" id="userNameDisplay">@user</span>
              <span className="user-badge" id="userPlanBadge">Free Plan</span>
            </div>
            <Settings className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </aside>

      {/* Main App Shell */}
      <main className="app-shell">
        <header className="top-bar">
          <div className="top-left">
            {sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(false)} className="icon-btn top-toggle-btn" id="sidebarToggleBtn" title="Toggle Sidebar" type="button">
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="model-dropdown-wrapper">
              <div onClick={() => setModelDropdownOpen(!modelMenuOpen)} className="model-badge" id="modelBadgeBtn">
                <span className="model-name" id="currentModelDisplay">{selectedModel === 'l1.0' ? 'NEO L1.0' : 'NEO L1.2 Pro'}</span>
                <ChevronDown className="w-4 h-4 model-chevron" />
              </div>

              {modelMenuOpen && (
                <div className="model-dropdown-menu show" id="modelDropdownMenu">
                  <div
                    onClick={() => { setSelectedModel('l1.0'); setModelDropdownOpen(false); }}
                    className={`model-option ${selectedModel === 'l1.0' ? 'active' : ''}`}
                    id="optL10"
                  >
                    <div className="model-opt-info">
                      <strong>NEO L1.0</strong>
                      <small>Text & Images • Fast Responses</small>
                    </div>
                  </div>
                  <div
                    onClick={() => { setSelectedModel('l1.2'); setModelDropdownOpen(false); }}
                    className={`model-option pro-option ${selectedModel === 'l1.2' ? 'active' : ''}`}
                    id="optL12"
                  >
                    <div className="model-opt-info">
                      <strong>NEO L1.2 Pro</strong>
                      <small>Audio, Video, Deep Reasoning & 4K Tokens</small>
                    </div>
                    <span className="pro-tag">PRO</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="top-right">
            <button onClick={toggleDarkMode} className="icon-btn" id="topBarDarkModeToggle" title="Toggle Theme" type="button">
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Scroll Area */}
        <div className="scroll-area" id="scrollArea">
          <div className="conversation-column">
            {activeMessages.length === 0 ? (
              <div className="hero-section" id="heroSection">
                <h1>What can I help with today?</h1>
                <p className="hero-copy">Powered by NEO Engine. Select a prompt or type your message below.</p>
                <div className="starter-grid">
                  <button type="button" onClick={() => handlePromptClick('Write a Python script to scrape website data cleanly.')}>
                    <Code2 className="w-4 h-4 text-purple-500" /><span>Python Scraper</span>
                  </button>
                  <button type="button" onClick={() => handlePromptClick('Explain quantum computing in simple terms.')}>
                    <Cpu className="w-4 h-4 text-purple-500" /><span>Quantum Computing</span>
                  </button>
                  <button type="button" onClick={() => handlePromptClick('Help me outline a business plan for a new SaaS product.')}>
                    <Lightbulb className="w-4 h-4 text-purple-500" /><span>SaaS Business Plan</span>
                  </button>
                  <button type="button" onClick={() => handlePromptClick('Draft a professional partnership proposal email.')}>
                    <MailCheck className="w-4 h-4 text-purple-500" /><span>Draft Partnership Email</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="chat-messages" id="chatMessages">
                {activeMessages.map((m) => (
                  <div key={m.id} className={`message ${m.role}`}>
                    <div className="message-content">
                      {m.role === 'assistant' ? renderFormattedText(m.content) : m.content}
                    </div>
                    {m.role === 'assistant' && (
                      <div className="message-actions">
                        <button onClick={() => handleCopy(m.id, m.content)} className="msg-action-btn copy-msg-btn" title="Copy" type="button">
                          {copiedId === m.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button className="msg-action-btn share-msg-btn" title="Share" type="button"><Share2 className="w-4 h-4" /></button>
                        <button className="msg-action-btn regen-msg-btn" title="Regenerate" type="button"><RotateCw className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer Dock */}
        <footer className="composer-dock">
          <div className="composer-wrapper" id="composerWrapper">
            <div className="glass-input-container" id="glassInputContainer">
              <form onSubmit={handleSubmit} className="composer-input-row">
                <button type="button" className="attach-btn" id="attachBtn" title="Add Attachments">
                  <Plus className="w-5 h-5" />
                </button>
                <textarea
                  id="chatInput"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                  placeholder="Message NEO..."
                />
                <button type="button" className="icon-btn mic-btn" id="micBtn" title="Voice Input">
                  <Mic className="w-4 h-4" />
                </button>
                <button type="submit" disabled={!input.trim() || isStreaming} className="send-btn" id="sendBtn" title="Send Message">
                  <ArrowUp className="w-4 h-4" />
                </button>
              </form>
            </div>
            <p className="composer-note">NEO may produce inaccurate info. Verify critical data.</p>
          </div>
        </footer>
      </main>

      {/* Artifact Preview Drawer */}
      {Boolean(currentArtifactCode && currentArtifactCode.trim().length > 0) && (
        <aside className="w-[45%] min-w-[360px] p-4 bg-slate-950 border-l border-slate-800 hidden lg:flex flex-col relative shrink-0">
          <button onClick={() => setCurrentArtifactCode('')} className="absolute top-2 right-2 text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
          <ArtifactPanel code={currentArtifactCode} />
        </aside>
      )}
    </div>
  );
}
