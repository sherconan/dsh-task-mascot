// dsh-task-mascot — host half.
// 1) Serves character packs (assets/packs/<pack>/manifest.json + media) read-only.
// 2) Observes session activity (session/event, agent/assistant-stream) and re-broadcasts a
//    small normalized activity stream over Server-Sent Events for the browser half.
// No external requests, no telemetry, never writes to sessions.
import { createReadStream, existsSync, statSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-task-mascot';
const ROUTE = '/api/dsh-task-mascot';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.join(HERE, '..', 'assets', 'packs');
const DEBUG_LOG = process.env.DSH_TASK_MASCOT_DEBUG_LOG || '';

const MIME = {
  '.json': 'application/json; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webp': 'image/webp', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
};

export function safeResolve(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return null;
  const target = path.normalize(path.join(root, rel));
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

export function listPacks(root = PACKS_DIR) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const mf = path.join(root, d.name, 'manifest.json');
    if (!existsSync(mf)) continue;
    try {
      const m = JSON.parse(readFileSync(mf, 'utf8'));
      out.push({ id: d.name, name: m.name || d.name, title: m.title || m.name || d.name, preview: m.preview || null, license: m.license || null });
    } catch { /* skip broken pack */ }
  }
  return out;
}

/** Normalize one durable session event into a tiny activity frame (or null). Exported for tests. */
export function normalizeSessionEvent(sessionId, event) {
  if (!event || typeof event.type !== 'string') return null;
  const d = event.data || {};
  const base = { sessionId: sessionId == null ? null : String(sessionId), ts: Date.now() };
  switch (event.type) {
    case 'turn/start': return { ...base, kind: 'turn-start' };
    case 'turn/end': return { ...base, kind: 'turn-end', reason: (d.reason && d.reason.kind) || 'completed' };
    case 'step/start': return { ...base, kind: 'step-start' };
    case 'tool/call': return { ...base, kind: 'tool-call', tool: typeof d.name === 'string' ? d.name : '', callId: d.callId || d.id || null, args: summarizeArgs(d.arguments ?? d.args ?? d.input) };
    case 'tool/result': { // real shape (dsh 0.2.1): data.message = { role:'tool', toolCallId, isError, content }
      const msg = d.message || {};
      return { ...base, kind: 'tool-result', callId: msg.toolCallId || (msg.source && msg.source.callId) || d.callId || d.id || null, tool: typeof d.name === 'string' ? d.name : '', error: !!(msg.isError || d.isError || d.error || d.status === 'error') };
    }
    case 'approval/asked': return { ...base, kind: 'approval', pending: true };
    case 'approval/decided': return { ...base, kind: 'approval', pending: false };
    case 'question/asked': case 'user-question/asked': return { ...base, kind: 'question', pending: true };
    case 'question/answered': case 'user-question/answered': return { ...base, kind: 'question', pending: false };
    case 'todo/write': return { ...base, kind: 'tool-call', tool: 'todo_write', callId: null };
    case 'user/message': return { ...base, kind: 'user-message' };
    case 'assistant/message': return { ...base, kind: 'assistant-message' };
    default: return null;
  }
}

// Privacy: the SSE stream is readable by the local web origin, so never forward commands, paths
// or queries verbatim. Only a coarse hint (target file extension) is kept, for "writing docs" vs "coding".
function summarizeArgs(a) {
  if (a == null) return undefined;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return undefined; } }
  if (typeof a !== 'object') return undefined;
  const p = a.path ?? a.file_path ?? a.filePath ?? a.target;
  if (typeof p !== 'string') return undefined;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(p);
  return m ? { ext: m[1].toLowerCase() } : undefined;
}

function sessionIdOf(session) {
  if (!session) return null;
  return session.id ?? session.sessionId ?? session.key ?? null;
}

export async function apply(ctx) {
  const clients = new Set();
  const recent = []; // ring buffer replayed to new SSE clients
  const lastStreamAt = new Map();
  const broadcast = (frame) => {
    if (!frame) return;
    recent.push(frame); if (recent.length > 50) recent.shift();
    const line = 'data: ' + JSON.stringify(frame) + '\n\n';
    for (const res of clients) { try { res.write(line); } catch { clients.delete(res); } }
  };
  const debug = (tag, obj) => {
    if (!DEBUG_LOG) return;
    try { appendFileSync(DEBUG_LOG, JSON.stringify({ t: new Date().toISOString(), tag, obj }, (k, v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v)) + '\n'); } catch { /* ignore */ }
  };

  ctx.on('session/event', (session, event) => {
    debug('session/event', { sid: sessionIdOf(session), type: event?.type, data: event?.data });
    broadcast(normalizeSessionEvent(sessionIdOf(session), event));
  });
  // Live token stream: throttle to one "generating" frame per session per 1.5s.
  ctx.on('agent/assistant-stream', (payload) => {
    const sid = payload?.sessionId ?? sessionIdOf(payload?.session) ?? payload?.agent?.sessionId ?? null;
    const chunkType = payload?.frame?.chunk?.type || payload?.frame?.type || '';
    const key = String(sid);
    const now = Date.now();
    if (now - (lastStreamAt.get(key) || 0) < 1500) return;
    lastStreamAt.set(key, now);
    debug('assistant-stream', { sid, chunkType, keys: Object.keys(payload || {}) });
    broadcast({ sessionId: sid == null ? null : String(sid), ts: now, kind: 'generating', reasoning: /reason|think/i.test(chunkType) });
  });

  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    const disposers = [];
    disposers.push(webServer.register({
      kind: 'exact', path: ROUTE + '/packs',
      handler: async (_req, res) => {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ packs: listPacks() }));
      },
    }));
    disposers.push(webServer.register({
      kind: 'exact', path: ROUTE + '/asset',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://127.0.0.1');
          const file = safeResolve(PACKS_DIR, url.searchParams.get('f') ?? '');
          if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
          const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
          const size = statSync(file).size;
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
          if (range) { // media elements need Range support for smooth looping/seeking
            let start = range[1] ? +range[1] : 0; let end = range[2] ? +range[2] : size - 1;
            if (!range[1] && range[2]) { start = size - +range[2]; end = size - 1; }
            if (start >= size || end >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
            res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' });
            createReadStream(file, { start, end }).pipe(res); return;
          }
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' });
          createReadStream(file).pipe(res);
        } catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end(String(e?.message ?? e)); }
      },
    }));
    disposers.push(webServer.register({
      kind: 'exact', path: ROUTE + '/events',
      handler: async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        for (const f of recent.filter((f) => Date.now() - f.ts < 30000)) res.write('data: ' + JSON.stringify({ ...f, replay: true }) + '\n\n');
        clients.add(res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 15000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
      },
    }));
    wctx.effect(() => () => { for (const d of disposers) try { d(); } catch { /* ignore */ } for (const r of clients) try { r.end(); } catch { /* ignore */ } clients.clear(); }, 'dsh-task-mascot: routes');
  });
  ctx.logger?.info?.('dsh-task-mascot: mounted (' + ROUTE + ')');
}
