'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Brain, Zap, CheckCircle2 } from 'lucide-react';

interface ThoughtChainProps {
  thinkingText: string;
  routeTarget: string;
  isThinking: boolean;
}

export default function ThoughtChainDrawer({ thinkingText, routeTarget, isThinking }: ThoughtChainProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!thinkingText && !isThinking) return null;

  return (
    <div className="my-3 rounded-xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-md overflow-hidden text-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-slate-300 hover:text-white bg-slate-800/40 hover:bg-slate-800/70 transition-all"
      >
        <div className="flex items-center gap-2">
          {routeTarget === 'deepseek' ? (
            <Brain className="w-4 h-4 text-purple-400 animate-pulse" />
          ) : (
            <Zap className="w-4 h-4 text-amber-400" />
          )}
          <span className="font-semibold text-slate-200">
            {routeTarget === 'deepseek' ? 'DeepSeek Reasoning Process' : 'Gemini Fast Stream'}
          </span>
          {isThinking ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              Thinking...
            </span>
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-3 bg-slate-950/60 text-slate-400 font-mono text-xs border-t border-slate-800/60 max-h-48 overflow-y-auto whitespace-pre-wrap"
          >
            {thinkingText || 'Decomposing task and verifying response...'}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
