import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

type AllowedRole = 'user' | 'assistant' | 'system';

interface MessagePayload {
  role: AllowedRole;
  content: string;
}

const MAX_MESSAGE_CONTENT_LENGTH = 10000;
const MAX_MESSAGES_COUNT = 50;

function validateEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.DEEPSEEK_API_KEY) missing.push('DEEPSEEK_API_KEY');
  if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
  return missing;
}

function getSupabaseServerClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return req.cookies.get(name)?.value; },
        set() {}, remove() {},
      },
    }
  );
}

function getSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function sanitizeReasoningOutput(rawChunk: string): string {
  if (!rawChunk || typeof rawChunk !== 'string') return 'Analyzing request...';
  const lower = rawChunk.toLowerCase();
  if (lower.includes('code') || lower.includes('function')) return 'Synthesizing code architecture...';
  if (lower.includes('math') || lower.includes('logic')) return 'Computing logical operations...';
  return 'Analyzing request...';
}

export async function POST(req: NextRequest) {
  const missingEnv = validateEnvVars();
  if (missingEnv.length > 0) {
    return NextResponse.json({ error: `Missing required env variables: ${missingEnv.join(', ')}` }, { status: 500 });
  }

  // Session Authentication
  const supabase = getSupabaseServerClient(req);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized user session' }, { status: 401 });
  }

  // Payload Validation
  let body: { messages: MessagePayload[]; selectedModel?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const { messages, selectedModel = 'deepseek-v4-flash' } = body;
  if (!messages || !Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES_COUNT) {
    return NextResponse.json({ error: 'Invalid messages payload' }, { status: 400 });
  }

  const primaryModel = selectedModel === 'gemini-3.1-flash-lite' ? 'gemini-3.1-flash-lite' : 'deepseek-v4-flash';
  const fallbackModel = primaryModel === 'deepseek-v4-flash' ? 'gemini-3.1-flash-lite' : 'deepseek-v4-flash';

  const encoder = new TextEncoder();
  const adminSupabase = getSupabaseAdminClient();

  const stream = new ReadableStream({
    async start(controller) {
      const promptTokenCount = Math.ceil(JSON.stringify(messages).length / 4);
      let completionTokenCount = 0;

      const sendSSE = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };

      try {
        sendSSE('status', { route: primaryModel, message: `Routing request to ${primaryModel}` });
        let streamSuccess = false;

        try {
          completionTokenCount = primaryModel === 'deepseek-v4-flash'
            ? await executeDeepSeekStream(messages, sendSSE)
            : await executeGeminiStream(messages, sendSSE);
          streamSuccess = true;
        } catch (primaryErr: unknown) {
          sendSSE('status', { route: fallbackModel, message: `Falling back to ${fallbackModel}` });
          completionTokenCount = fallbackModel === 'deepseek-v4-flash'
            ? await executeDeepSeekStream(messages, sendSSE)
            : await executeGeminiStream(messages, sendSSE);
          streamSuccess = true;
        }

        if (streamSuccess) {
          sendSSE('done', { status: 'complete' });
          const totalTokens = promptTokenCount + Math.max(1, completionTokenCount);
          
          try {
            await adminSupabase.rpc('deduct_user_tokens', { p_user_id: user.id, p_tokens: totalTokens });
          } catch {
            // Ignore token deduction error safely
          }
        }
      } catch (fatalErr: unknown) {
        const msg = fatalErr instanceof Error ? fatalErr.message : 'Execution failed';
        sendSSE('error', { error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}

async function executeDeepSeekStream(messages: MessagePayload[], sendSSE: (t: string, d: unknown) => void): Promise<number> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: 'deepseek-v4-flash', messages, stream: true }),
  });

  if (!res.ok) throw new Error(`DeepSeek API error HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Unreadable stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let tokenCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) sendSSE('thinking', sanitizeReasoningOutput(delta.reasoning_content));
          if (delta?.content) { tokenCount++; sendSSE('content', delta.content); }
        } catch {}
      }
    }
  }
  return tokenCount;
}

async function executeGeminiStream(messages: MessagePayload[], sendSSE: (t: string, d: unknown) => void): Promise<number> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`;
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  if (!res.ok) throw new Error(`Gemini API error HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Unreadable stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let tokenCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6));
          const textPart = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textPart) { tokenCount++; sendSSE('content', textPart); }
        } catch {}
      }
    }
  }
  return tokenCount;
}
