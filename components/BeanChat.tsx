'use client';

import { useEffect, useState } from 'react';
import { createClientComponentSupabase } from '@/lib/supabaseClient';
import { Send, MessageSquare } from 'lucide-react';

interface BeanMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export default function BeanChat({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const [messages, setMessages] = useState<BeanMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const supabase = createClientComponentSupabase();

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (data) setMessages(data);
    };

    fetchMessages();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `room_id=eq.${roomId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as BeanMessage])
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId, supabase]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    await supabase.from('direct_messages').insert({
      room_id: roomId,
      sender_id: currentUserId,
      content: newMessage,
    });

    setNewMessage('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-slate-200">Bean Realtime Workspace</span>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.sender_id === currentUserId ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[75%] px-3.5 py-2 rounded-xl text-xs ${
              msg.sender_id === currentUserId ? 'bg-purple-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSendMessage} className="p-3 bg-slate-950/50 border-t border-slate-800 flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Send message on Bean..."
          className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-purple-500"
        />
        <button type="submit" className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs">
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
