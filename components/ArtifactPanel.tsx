'use client';

import { useState } from 'react';
import { Code, Play } from 'lucide-react';

interface ArtifactPanelProps {
  code: string;
  title?: string;
}

export default function ArtifactPanel({ code, title = 'Generated Code Preview' }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');

  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>body { background: #0f172a; color: #f8fafc; font-family: sans-serif; padding: 1rem; }</style>
      </head>
      <body>${code}</body>
    </html>
  `;

  return (
    <div className="flex flex-col h-full border border-slate-800 rounded-2xl bg-slate-900/90 overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950/80 border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-300">{title}</span>
        <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/50">
          <button
            onClick={() => setActiveTab('preview')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'preview' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Play className="w-3 h-3" /> Preview
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'code' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Code className="w-3 h-3" /> Code
          </button>
        </div>
      </div>

      <div className="flex-1 bg-slate-950/40 relative">
        {activeTab === 'preview' ? (
          <iframe
            title="Sandbox Preview"
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-modals"
            className="w-full h-full border-none rounded-b-2xl"
          />
        ) : (
          <pre className="p-4 text-xs font-mono text-purple-300 overflow-auto h-full whitespace-pre-wrap">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}
