import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

interface IncomingMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, mode = 'auto' } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const latestText = messages[messages.length - 1]?.content || '';
    const reasoningKeywords = ['proof', 'algorithm', 'refactor', 'math', 'architecture', 'derive', 'logic'];
    const isReasoningNeeded = mode === 'deepseek-reasoning' || reasoningKeywords.some(kw => latestText.toLowerCase().includes(kw));

    const routeTarget = isReasoningNeeded ? 'deepseek' : 'gemini-flash';
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendChunk = (type: string, data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        };

        try {
          sendChunk('status', { route: routeTarget, message: `Routing to ${routeTarget}` });

          if (routeTarget === 'deepseek') {
            const apiKey = process.env.DEEPSEEK_API_KEY;
            const res = await fetch('https://api.deepseek.com/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({ model: 'deepseek-reasoner', messages, stream: true }),
            });

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                      const parsed = JSON.parse(line.slice(6));
                      const reasoning = parsed.choices?.[0]?.delta?.reasoning_content;
                      const text = parsed.choices?.[0]?.delta?.content;
                      if (reasoning) sendChunk('thinking', reasoning);
                      if (text) sendChunk('content', text);
                    } catch {}
                  }
                }
              }
            }
          } else {
            const apiKey = process.env.GEMINI_API_KEY;
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
            const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents }),
            });

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const parsed = JSON.parse(line.slice(6));
                      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                      if (text) sendChunk('content', text);
                    } catch {}
                  }
                }
              }
            }
          }
          sendChunk('done', { status: 'complete' });
        } catch (err: any) {
          sendChunk('error', { error: err.message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
