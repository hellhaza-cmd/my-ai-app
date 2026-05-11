const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Health check ──────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === '/') {
      return new Response('My AI Proxy is running ✓', {
        headers: { 'Content-Type': 'text/plain', ...CORS }
      });
    }

    // ── Stream chat to Anthropic ───────────────────────────────────────────────
    if (request.method === 'POST' && path === '/') {
      try {
        const body = await request.json();
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ ...body, stream: true }),
        });
        return new Response(response.body, {
          status: response.status,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            ...CORS,
          }
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: { message: err.message } }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } }
        );
      }
    }

    // ── Get all chats for a user ───────────────────────────────────────────────
    if (request.method === 'GET' && path === '/chats') {
      if (!env.CHATS) return json([], 200);
      const userId = url.searchParams.get('u') || 'default';
      try {
        const list = await env.CHATS.list({ prefix: `${userId}:` });
        const chats = (await Promise.all(
          list.keys.map(async k => {
            const v = await env.CHATS.get(k.name);
            return v ? JSON.parse(v) : null;
          })
        )).filter(Boolean).sort((a, b) => b.ts - a.ts);
        return json(chats, 200);
      } catch { return json([], 200); }
    }

    // ── Save a chat ────────────────────────────────────────────────────────────
    if (request.method === 'POST' && path === '/chats') {
      if (!env.CHATS) return json({ ok: false, reason: 'no_kv' }, 200);
      try {
        const chat = await request.json();
        const userId = chat.userId || 'default';
        await env.CHATS.put(
          `${userId}:${chat.id}`,
          JSON.stringify(chat),
          { expirationTtl: 60 * 60 * 24 * 180 } // 180 days
        );
        return json({ ok: true }, 200);
      } catch (e) { return json({ ok: false, reason: e.message }, 200); }
    }

    // ── Delete a chat ──────────────────────────────────────────────────────────
    if (request.method === 'DELETE' && path.startsWith('/chats/')) {
      if (!env.CHATS) return json({ ok: false }, 200);
      try {
        const chatId = path.split('/chats/')[1];
        const userId = url.searchParams.get('u') || 'default';
        await env.CHATS.delete(`${userId}:${chatId}`);
        return json({ ok: true }, 200);
      } catch { return json({ ok: false }, 200); }
    }

    return new Response('Not found', { status: 404, headers: CORS });
  }
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}
