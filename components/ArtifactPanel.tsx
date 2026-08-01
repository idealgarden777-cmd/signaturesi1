'use client';

import { useState } from 'react';
import { Code, Play, Copy, Check } from 'lucide-react';

interface ArtifactPanelProps {
  code: string;
  title?: string;
}

export default function ArtifactPanel({ code, title = 'Generated Code Preview' }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com;">`;

  const srcDoc = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${cspMeta}
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          body { background-color: #0f172a; color: #f8fafc; font-family: sans-serif; margin: 0; padding: 1rem; }
        </style>
      </head>
      <body>
        ${code}
      </body>
    </html>
  `;

  return (
    <div className="flex flex-col h-full border border-slate-800 rounded-2xl bg-slate-900/90 overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950/80 border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-300 truncate max-w-[200px]">{title}</span>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-lg text-xs flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/50">
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1 rounded-md text-xs font-medium ${
                activeTab === 'preview' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Play className="w-3 h-3" /> Preview
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1 rounded-md text-xs font-medium ${
                activeTab === 'code' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code className="w-3 h-3" /> Code
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-slate-950/40 relative overflow-hidden">
        {activeTab === 'preview' ? (
          <iframe
            title="Artifact Preview Sandbox"
            srcDoc={srcDoc}
            sandbox="allow-scripts"
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
