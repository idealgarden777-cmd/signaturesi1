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
  Code2,
  Cpu,
  Lightbulb,
  MailCheck,
  PanelLeftClose,
  PanelLeft,
  X,
  Trash2,
  Check,
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
    <div className={`app-container ${darkMode ? 'dark-mode' : ''}`}>
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
            <Columns2 size={20} />
          </button>
        </div>

        <div className="sidebar-content">
          <nav className="sidebar-primary-nav" aria-label="Primary navigation">
            <button onClick={handleNewConversation} className="new-chat-btn" id="newChatBtn" type="button" title="New conversation">
              <span className="sidebar-nav-icon"><SquarePen size={18} /></span>
              <span>New Conversation</span>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="sidebar-personality-btn"
              id="sidebarPersonalitiesBtn"
              type="button"
              title="NEO Personalities"
            >
              <span className="sidebar-nav-icon"><Sparkles size={18} /></span>
              <span>NEO Personalities</span>
            </button>
          </nav>

          <div className="history-section">
            <span className="section-title">Recent Chats</span>
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
                    className="icon-btn"
                    title="Delete Chat"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <button onClick={() => setSettingsOpen(true)} className="user-profile-btn" id="userProfileBtn" type="button">
            <div id="userAvatar">U</div>
            <div className="user-info">
              <span className="user-name" id="userNameDisplay">@leo</span>
              <span className="user-badge" id="userPlanBadge">Free Plan</span>
            </div>
            <Settings size={18} className="more-icon" />
          </button>
        </div>
      </aside>

      {/* Main App Shell */}
      <main className="app-shell">
        <header className="top-bar">
          <div className="top-left">
            {sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(false)} className="icon-btn top-toggle-btn" id="sidebarToggleBtn" title="Toggle Sidebar" type="button">
                <Columns2 size={20} />
              </button>
            )}

            <div className="model-dropdown-wrapper">
              <div onClick={() => setModelDropdownOpen(!modelMenuOpen)} className="model-badge" id="modelBadgeBtn">
                <span className="model-name" id="currentModelDisplay">{selectedModel === 'l1.0' ? 'NEO L1.0' : 'NEO L1.2 Pro'}</span>
                <ChevronDown size={16} className="model-chevron" />
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
                      <small>Text & Images • Snappy Responses</small>
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
              <Sun size={20} />
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
                    <Code2 size={16} /><span>Python Scraper</span>
                  </button>
                  <button type="button" onClick={() => handlePromptClick('Explain quantum computing in simple terms.')}>
                    <Cpu size={16} /><span>Quantum Computing</span>
                  </button>
                  <button type="button" onClick={() => handlePromptClick('Help me outline a business plan for a new SaaS product.')}>
                    <Lightbulb size={16} /><span>SaaS Business Plan</span>
                  </button>
                  <button type="button" onClick={() => handlePromptClick('Draft a professional partnership proposal email.')}>
                    <MailCheck size={16} /><span>Draft Partnership Email</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="chat-messages" id="chatMessages">
                {activeMessages.map((m) => (
                  <div key={m.id} className={`message ${m.role}`}>
                    <div className="message-content">
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                    {m.role === 'assistant' && (
                      <div className="message-actions">
                        <button onClick={() => handleCopy(m.id, m.content)} className="msg-action-btn copy-msg-btn" title="Copy" type="button">
                          {copiedId === m.id ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                        </button>
                        <button className="msg-action-btn share-msg-btn" title="Share" type="button"><Share2 size={16} /></button>
                        <button className="msg-action-btn regen-msg-btn" title="Regenerate" type="button"><RotateCw size={16} /></button>
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
                  <Plus size={20} />
                </button>
                <textarea
                  id="chatInput"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message NEO..."
                />
                <button type="button" className="icon-btn mic-btn" id="micBtn" title="Voice Input">
                  <Mic size={16} />
                </button>
                <button type="submit" disabled={!input.trim() || isStreaming} className="send-btn" id="sendBtn" title="Send Message">
                  <ArrowUp size={18} />
                </button>
              </form>
            </div>
            <p className="composer-note">NEO may produce inaccurate info. Verify critical data.</p>
          </div>
        </footer>
      </main>

      {/* Artifact Preview Drawer */}
      {currentArtifactCode && (
        <aside className="w-[45%] min-w-[360px] p-4 bg-slate-950 border-l border-slate-800/80 hidden lg:flex flex-col relative shrink-0">
          <button
            onClick={() => setCurrentArtifactCode('')}
            className="absolute top-2 right-2 text-slate-400 hover:text-white p-1 z-10"
            title="Close Sandbox"
          >
            <X size={16} />
          </button>
          <ArtifactPanel code={currentArtifactCode} />
        </aside>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="neo-settings-overlay show" id="neoSettingsOverlay">
          <div className="neo-settings-modal">
            <aside className="neo-settings-sidebar">
              <button onClick={() => setSettingsOpen(false)} className="neo-settings-close" id="neoSettingsCloseBtn">
                <X size={20} />
              </button>
              <div className="neo-settings-tab active">General</div>
              <div className="neo-settings-tab">Personalities</div>
            </aside>
            <section className="neo-settings-content">
              <h2>Settings</h2>
              <p className="settings-subtitle">Manage preferences for NEO Central.</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
