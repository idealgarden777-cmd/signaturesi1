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
  Check
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
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');

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

                  // Dynamic HTML Artifact Detection
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
    <div className={`flex h-screen w-full bg-[#fcfcfc] text-slate-800 antialiased overflow-hidden ${darkMode ? 'dark-mode' : ''}`}>
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <button className="brand-button" type="button">
            <span className="brand-copy">
              <strong>NEO Engine</strong>
              <small>Signaturesi Central</small>
            </span>
          </button>
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="icon-btn"
            title="Close Sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-primary-nav">
            <button onClick={handleNewConversation} className="new-chat-btn" type="button">
              <Edit3 className="w-4 h-4" />
              <span>New Conversation</span>
            </button>
            <button
              onClick={() => {
                setActiveSettingsTab('personalities');
                setSettingsOpen(true);
              }}
              className="sidebar-personality-btn"
              type="button"
            >
              <Sparkles className="w-4 h-4" />
              <span>NEO Personalities</span>
            </button>
          </div>

          <div className="history-section">
            <span className="section-title">Recent Chats</span>
            <div className="history-list">
              {recentChats.map((chat, i) => (
                <button key={i} className="history-item">
                  {chat}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <button
            onClick={() => setSettingsOpen(true)}
            className="user-profile-btn"
            type="button"
          >
            <div id="userAvatar">.9</div>
            <div className="user-info">
              <span className="user-name">@leo</span>
              <span className="user-badge">Free Plan</span>
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
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="icon-btn"
                title="Open Sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="model-dropdown-wrapper">
              <div
                onClick={() => setModelDropdownOpen(!modelMenuOpen)}
                className="model-badge"
              >
                <span className="model-name">
                  {selectedModel === 'l1.0' ? 'NEO L1.0' : 'NEO L1.2 Pro'}
                </span>
                <ChevronDown className="w-4 h-4 model-chevron" />
              </div>

              {modelMenuOpen && (
                <div className="model-dropdown-menu show">
                  <div
                    onClick={() => {
                      setSelectedModel('l1.0');
                      setModelDropdownOpen(false);
                    }}
                    className={`model-option ${selectedModel === 'l1.0' ? 'active' : ''}`}
                  >
                    <div className="model-opt-info">
                      <strong>NEO L1.0</strong>
                      <small>Text & Images • Snappy Responses</small>
                    </div>
                  </div>
                  <div
                    onClick={() => {
                      setSelectedModel('l1.2');
                      setModelDropdownOpen(false);
                    }}
                    className={`model-option pro-option ${selectedModel === 'l1.2' ? 'active' : ''}`}
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
            <button onClick={toggleDarkMode} className="icon-btn" title="Toggle Theme">
              <Sun className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scroll Area */}
        <div className="scroll-area">
          <div className="conversation-column">
            {messages.length === 0 ? (
              <div className="hero-section">
                <h1>What can I help with today?</h1>
                <p className="hero-copy">Powered by NEO Engine. Select a prompt or type your message below.</p>
                <div className="starter-grid">
                  <button
                    onClick={() => handlePromptClick('Write a Python script to scrape website data cleanly.')}
                  >
                    <Code2 className="w-4 h-4" />
                    <span>Python Scraper</span>
                  </button>
                  <button
                    onClick={() => handlePromptClick('Explain quantum computing in simple terms.')}
                  >
                    <Cpu className="w-4 h-4" />
                    <span>Quantum Computing</span>
                  </button>
                  <button
                    onClick={() => handlePromptClick('Help me outline a business plan for a new SaaS product.')}
                  >
                    <Lightbulb className="w-4 h-4" />
                    <span>SaaS Business Plan</span>
                  </button>
                  <button
                    onClick={() => handlePromptClick('Draft a professional partnership proposal email.')}
                  >
                    <MailCheck className="w-4 h-4" />
                    <span>Draft Partnership Email</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="chat-messages">
                {messages.map((m) => (
                  <div key={m.id} className={`message ${m.role}`}>
                    <div className="message-content">
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                    {m.role === 'assistant' && (
                      <div className="message-actions">
                        <button onClick={() => handleCopy(m.id, m.content)} className="msg-action-btn">
                          {copiedId === m.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                        <button className="msg-action-btn"><Share2 className="w-4 h-4" /></button>
                        <button className="msg-action-btn"><RotateCw className="w-4 h-4" /></button>
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
          <div className="composer-wrapper">
            <div className="glass-input-container">
              <form onSubmit={handleSubmit} className="composer-input-row">
                <button type="button" className="attach-btn" title="Add Attachments">
                  <Plus className="w-5 h-5" />
                </button>
                <textarea
                  id="chatInput"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message NEO..."
                />
                <button type="button" className="mic-btn" title="Voice Input">
                  <Mic className="w-4 h-4" />
                </button>
                <button type="submit" disabled={!input.trim() || isStreaming} className="send-btn">
                  <ArrowUp className="w-4 h-4" />
                </button>
              </form>
            </div>
            <p className="composer-note">NEO may produce inaccurate info. Verify critical data.</p>
          </div>
        </footer>
      </main>

      {/* Live Artifact Sandbox Panel */}
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

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="neo-settings-overlay show">
          <div className="neo-settings-modal">
            <aside className="neo-settings-sidebar">
              <button onClick={() => setSettingsOpen(false)} className="neo-settings-close">
                <X className="w-5 h-5" />
              </button>
              <button
                onClick={() => setActiveSettingsTab('general')}
                className={`neo-settings-tab ${activeSettingsTab === 'general' ? 'active' : ''}`}
              >
                General
              </button>
              <button
                onClick={() => setActiveSettingsTab('personalities')}
                className={`neo-settings-tab ${activeSettingsTab === 'personalities' ? 'active' : ''}`}
              >
                Personalities
              </button>
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
