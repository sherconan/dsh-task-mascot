// dsh-task-mascot — browser half. Plain JS in the dsh ModuleLoader format (no build step).
window.__ModuleLoader__.load({
  id: 'dsh-task-mascot',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const h = React.createElement;
    const API = '/api/dsh-task-mascot';
    const LS_KEY = 'dsh-task-mascot:settings:v1';

    // ---------------------------------------------------------------- mapping
    /** Default tool → state rules, first match wins. `ext` (optional) matches the target file extension. */
    const DEFAULT_RULES = [
      // v2: shell commands are sub-classified by the command text (`cmd` regex, browser-side only)
      { tool: '^(bash|pwsh)$', cmd: '^\\s*(git\\s+diff|diff|cmp)\\b', state: 'diff' },
      { tool: '^(bash|pwsh)$', cmd: '^\\s*(git|gh)\\b', state: 'git' },
      { tool: '^(bash|pwsh)$', cmd: '(^|[;&|]\\s*)((npm|pnpm|yarn|bun)\\s+(run\\s+)?test|npx\\s+(jest|vitest|playwright)|pytest|jest|vitest|go\\s+test|cargo\\s+test|node\\s+--test|make\\s+test|mvn\\s+test)\\b', state: 'test' },
      { tool: '^(bash|pwsh)$', cmd: '(^|[;&|]\\s*)(sudo\\s+)?((npm|pnpm|yarn|bun)\\s+(i|install|add|ci)|pip3?\\s+install|uv\\s+(add|pip\\s+install|sync)|apt(-get)?\\s+install|brew\\s+install|cargo\\s+(add|install)|go\\s+get|gem\\s+install|Install-Module)\\b', state: 'install' },
      { tool: '^(bash|pwsh)$', cmd: '(^|[;&|]\\s*)(curl|wget|aria2c|Invoke-WebRequest|iwr|scp|rsync)\\b', state: 'download' },
      { tool: '^(bash|pwsh)$', cmd: '(^|[;&|]\\s*)(sudo\\s+)?(rm|rmdir|unlink|del|Remove-Item|shred)\\b', state: 'delete' },
      { tool: '^(write|edit|str_replace_editor)$', ext: '^(md|mdx|txt|rst|adoc|docx?|tex)$', state: 'writingdoc' },
      { tool: '^write$', state: 'coding' },
      { tool: '^(edit|str_replace_editor)$', state: 'editing' },
      { tool: '^read_image$', state: 'media' },
      { tool: '^(mcp__.*|mcp[_-].*|list_mcp_resources|read_mcp_resource)$', state: 'mcp' },
      { tool: '^(read|lsp|cordis_inspect_.*)$', state: 'reading' },
      { tool: '^session_.*$', state: 'memory' },
      { tool: '^(glob|grep)$', state: 'search' },
      { tool: '^(web_search|web_fetch|stagehand_.*)$', state: 'web' },
      { tool: '^(create_worktree|load_workspace_dependencies)$', state: 'git' },
      { tool: '^(bash|pwsh|terminal_.*|job_.*)$', state: 'cmd' },
      { tool: '^(run_code|workflow)$', state: 'data' },
      { tool: '^(todo_write|exit_plan_mode|create_goal|get_goal|update_goal|schedule_.*)$', state: 'planning' },
      { tool: '^(subagent|list_subagent_models|send_message|list_agents|interrupt_agent|spawn_teammate|team_task_.*|ralph)$', state: 'subagents' },
      { tool: '^ask_user_question$', state: 'waiting' },
      { tool: '^present$', state: 'summary' },
      { tool: '^(skill|plugin_manager|plugin_market|working_directory)$', state: 'tools' },
      { tool: '.*', state: 'tools' },
    ];
    const ALL_STATES = ['idle', 'thinking', 'reading', 'search', 'coding', 'editing', 'writingdoc', 'cmd', 'data', 'planning', 'subagents', 'tools', 'summary', 'waiting', 'done', 'error',
      // v2
      'web', 'download', 'git', 'test', 'install', 'create', 'delete', 'mcp', 'memory', 'media', 'diff',
      'retry', 'worried', 'busy', 'subtask', 'denied', 'interrupted', 'sweat', 'tired', 'cheer'];

    function compileRules(rules) {
      const out = [];
      for (const r of rules || []) {
        try { out.push({ tool: new RegExp(r.tool || '.*', 'i'), ext: r.ext ? new RegExp(r.ext, 'i') : null, cmd: r.cmd ? new RegExp(r.cmd, 'i') : null, state: String(r.state || 'tools') }); } catch (_e) { /* skip bad regex */ }
      }
      return out;
    }
    function stateForTool(tool, args, compiled) {
      const ext = args && typeof args === 'object' ? args.ext : undefined;
      const cmd = args && typeof args === 'object' && typeof args.command === 'string' ? args.command : undefined;
      for (const r of compiled) {
        if (!r.tool.test(tool || '')) continue;
        if (r.ext && !(ext && r.ext.test(ext))) continue;
        if (r.cmd && !(cmd && r.cmd.test(cmd))) continue;
        return r.state;
      }
      return 'tools';
    }
    /** Resolve a logical state to a state the pack actually has, via manifest fallbacks then a global chain. */
    const GLOBAL_FALLBACK = { writingdoc: ['editing', 'coding'], data: ['cmd', 'thinking'], tools: ['cmd', 'thinking'], subagents: ['planning', 'tools'], summary: ['done', 'thinking'], idle: ['waiting', 'thinking'], generating: ['thinking'],
      // v2 states degrade gracefully on packs that only ship the v1 set (e.g. claude)
      web: ['search'], download: ['web', 'cmd'], git: ['cmd'], test: ['cmd'], install: ['download', 'cmd'], create: ['coding'], delete: ['cmd'], mcp: ['tools', 'cmd'], memory: ['search', 'reading'], media: ['reading'], diff: ['editing', 'reading'],
      retry: ['error', 'thinking'], worried: ['error'], busy: ['cmd', 'thinking'], subtask: ['done'], denied: ['error'], interrupted: ['waiting', 'idle'], sweat: ['thinking'], tired: ['waiting', 'thinking'], cheer: ['done'] };
    /**
     * A/B variants: manifest.variants = { coding: ['coding','coding_b'], ... }. `mode` 'alternate' picks by
     * seed parity (step number), 'random' hashes the seed, 'off' keeps the base state. Deterministic per seed so
     * a step never flickers between variants across re-renders.
     */
    function pickVariant(state, manifest, seed, mode) {
      const list = manifest && manifest.variants && manifest.variants[state];
      if (!state || !Array.isArray(list) || list.length < 2 || mode === 'off') return state;
      const ok = list.filter((s) => manifest.states && manifest.states[s]); if (!ok.length) return state;
      let i = seed | 0;
      if (mode === 'random') { let x = (i + 0x9e3779b9) | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); i = (x ^ (x >>> 16)) >>> 0; }
      return ok[Math.abs(i) % ok.length];
    }
    function resolveState(state, manifest) {
      const has = (s) => !!(manifest && manifest.states && manifest.states[s]);
      const seen = new Set(); const queue = [state];
      while (queue.length) {
        const s = queue.shift(); if (seen.has(s)) continue; seen.add(s);
        if (has(s)) return s;
        const fb = (manifest && manifest.fallback && manifest.fallback[s]) || GLOBAL_FALLBACK[s] || [];
        queue.push(...fb);
      }
      const star = (manifest && manifest.fallback && manifest.fallback['*']) || ['thinking'];
      for (const s of star) if (has(s)) return s;
      const keys = manifest && manifest.states ? Object.keys(manifest.states) : [];
      return keys[0] || null;
    }

    // ---------------------------------------------------------------- activity state machine
    /**
     * Tracks one "focus" session. Priority: error/done one-shot > waiting (approval/question) >
     * active tool > generating/thinking > idle.
     */
    function createMachine(opts) {
      const o = Object.assign({ oneShotMs: 3000, toolLingerMs: 1200, idleAfterMs: 20000, now: () => Date.now() }, opts || {});
      let compiled = compileRules(o.rules || DEFAULT_RULES);
      const st = { running: false, waiting: false, tools: new Map(), lastTool: null, lastToolEnd: 0, oneShot: null, lastActivity: 0, sessionId: null, label: '' };
      function setRules(r) { compiled = compileRules(r && r.length ? r : DEFAULT_RULES); }
      function feed(f) {
        if (!f || !f.kind) return;
        const t = o.now();
        if (f.sessionId) st.sessionId = f.sessionId;
        st.lastActivity = t;
        switch (f.kind) {
          case 'turn-start': case 'user-message': st.running = true; st.oneShot = null; break;
          case 'step-start': case 'generating': st.running = true; break;
          case 'tool-call': {
            st.running = true;
            const s = stateForTool(f.tool, f.args, compiled);
            st.tools.set(f.callId || f.tool + ':' + t, { state: s, tool: f.tool, at: t });
            st.lastTool = { state: s, tool: f.tool }; st.label = f.tool || '';
            break;
          }
          case 'tool-result': {
            if (f.callId && st.tools.has(f.callId)) st.tools.delete(f.callId);
            else if (st.tools.size) st.tools.delete(st.tools.keys().next().value);
            st.lastToolEnd = t;
            break;
          }
          case 'approval': case 'question': st.waiting = !!f.pending; break;
          case 'turn-end': {
            st.running = false; st.waiting = false; st.tools.clear();
            const err = f.reason && !/^(completed|complete|stop|end_turn|done|ok)$/i.test(f.reason) && /error|fail/i.test(f.reason);
            const cancelled = /cancel|interrupt|abort/i.test(f.reason || '');
            if (!cancelled) st.oneShot = { state: err ? 'error' : 'done', until: t + o.oneShotMs };
            break;
          }
          default: break;
        }
      }
      /** Coarse status from useSessions() (fallback when SSE is absent). */
      function feedStatus(s) {
        if (!s) return;
        const t = o.now();
        if (s.pendingInteraction && !st.waiting) { st.waiting = true; st.lastActivity = t; }
        if (!s.pendingInteraction && st.waiting && s.source === 'status') st.waiting = false;
        if (s.running && !st.running) { st.running = true; st.lastActivity = t; }
        if (s.running === false && st.running && s.source === 'status') { feed({ kind: 'turn-end', reason: s.error ? 'error' : 'completed' }); }
      }
      function current() {
        const t = o.now();
        if (st.oneShot && t < st.oneShot.until) return { state: st.oneShot.state, oneShot: true, label: st.oneShot.state };
        if (st.oneShot && t >= st.oneShot.until) st.oneShot = null;
        if (st.waiting) return { state: 'waiting', label: 'waiting' };
        if (st.tools.size) { const last = Array.from(st.tools.values()).pop(); return { state: last.state, label: last.tool }; }
        if (st.running && st.lastTool && t - st.lastToolEnd < o.toolLingerMs) return { state: st.lastTool.state, label: st.lastTool.tool };
        if (st.running) return { state: 'thinking', label: 'thinking' };
        return { state: 'idle', label: 'idle' };
      }
      return { feed, feedStatus, current, setRules, _st: st };
    }

    // ---------------------------------------------------------------- v2: step tracker over the authenticated in-browser event stream
    const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); n = n || 48; return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const shortPath = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');
    const extOf = (p) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(p || '')); return m ? m[1].toLowerCase() : undefined; };
    /** Parse possibly-incomplete streamed JSON arguments; falls back to regex-extracting known string fields. */
    function partialArgs(raw) {
      if (raw && typeof raw === 'object') return raw;
      try { const v = JSON.parse(raw); if (v && typeof v === 'object') return v; } catch (_e) { /* partial */ }
      const o = {}; const src = String(raw || '');
      for (const k of ['file_path', 'path', 'pattern', 'command', 'description', 'query', 'url', 'prompt', 'name', 'server', 'tool']) {
        const m = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(src);
        if (m) { let v; try { v = JSON.parse('"' + m[1] + '"'); } catch (_e) { v = m[1].replace(/\\(["\\/])/g, '$1').replace(/\\[nrt]/g, ' '); } o[k] = v; }
      }
      const q = /"queries"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(src); if (q) o.queries = [q[1]];
      return o;
    }
    /** Chinese one-line description of what a tool call is doing (args stay in the browser). */
    function actionText(tool, a) {
      a = a || {}; const t = String(tool || ''); const f = shortPath(a.file_path || a.path || a.notebook_path);
      if (!t) return '准备调用工具…';
      if (/^(mcp__|mcp[_-])/i.test(t)) { const parts = t.replace(/^mcp(__|[_-])/i, '').split(/__|\//); return '调用 MCP: ' + clip(parts.join(' · '), 40); }
      switch (t) {
        case 'read': case 'read_image': return '正在读 ' + (f || '文件');
        case 'write': return '正在写 ' + (f || '文件');
        case 'edit': case 'str_replace_editor': return '正在改 ' + (f || '文件');
        case 'grep': return '正在搜索 "' + clip(a.pattern, 30) + '"' + (a.path && a.path !== '.' ? ' @ ' + shortPath(a.path) : '');
        case 'glob': return '正在查找文件 ' + clip(a.pattern, 36);
        case 'web_search': return '正在联网搜索 "' + clip((a.queries && a.queries[0]) || a.query, 30) + '"';
        case 'web_fetch': return '正在抓取 ' + clip(a.url, 40);
        case 'bash': case 'pwsh': return a.command ? '运行 ' + clip(a.command, 44) : '准备运行命令…';
        case 'session_search': case 'session_read': case 'session_list': return '翻看历史会话' + (a.query ? ' "' + clip(a.query, 24) + '"' : '');
        case 'list_mcp_resources': return '列出 MCP 资源';
        case 'read_mcp_resource': return '读取 MCP 资源 ' + clip(a.uri || a.server, 30);
        case 'create_worktree': return '新建 Git worktree';
        case 'wait_agent': return '等子代理回来';
        case 'todo_write': return '正在更新待办' + (Array.isArray(a.todos) ? '（' + a.todos.length + ' 项）' : '');
        case 'subagent': case 'spawn_teammate': return '派出子代理：' + clip(a.description || a.prompt, 36);
        case 'send_message': return '给子代理发消息';
        case 'ask_user_question': return '正在向你提问';
        case 'job_output': return '查看后台任务输出';
        case 'present': return '正在展示交付物';
        case 'lsp': return '查询代码索引';
        default: return '调用工具 ' + t + (f ? ' · ' + f : '');
      }
    }
    // DSH reports a non-zero shell exit as a normal (isError:false) result ending in "[exit code: N]". Treat it as a failure,
// except for commands whose non-zero exit is an answer rather than an error (diff/cmp/grep/test/[).
function shellFailed(st, m) {
  if (!/^(bash|pwsh|powershell|shell)$/.test(st.tool)) return false;
  const c = m.content; const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('\n') : '';
  const mm = /\[exit code: (\d+)\]\s*$/.exec(txt); if (!mm || mm[1] === '0') return false;
  return !/^\s*(git\s+diff|diff|cmp|grep|rg|test|\[)\b/.test(String(st.args.command || ''));
}
function resultBrief(message) {
      const m = message || {}; const c = m.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('\n') : '';
      const line = text.split('\n').map((x) => x.replace(/<\/?[a-z_]+>/g, '').trim()).find((x) => x && !/^\[(stderr|stdout)\]$/.test(x)) || '';
      return clip(line.replace(/^Error:\s*/i, ''), 70);
    }
    let frameSeq = 0;
    /**
     * Pure reducer + display queue for one Session. feed() takes SessionEventLikeEntry objects
     * ({type:'event'|'transient', event}). Live entries enqueue display frames that are each shown
     * for at least `dwellMs`; history entries rebuild state silently.
     */
    function createTracker(opts) {
      // v2 knobs: stepSlowMs = one step/think this long -> sweat (x3 -> tired); loopLongMs = whole turn this long ->
      // tired while thinking, cheer on success; busyN = this many tool calls without thinking in between -> busy;
      // worriedN = this many consecutive failures -> worried.
      const o = Object.assign({ dwellMs: 600, now: () => Date.now(), schedule: (fn, ms) => setTimeout(fn, ms), rules: null, stepSlowMs: 20000, loopLongMs: 120000, busyN: 5, worriedN: 2 }, opts || {});
      let compiled = compileRules(o.rules || DEFAULT_RULES);
      const S = { turn: 0, active: false, turnStart: 0, turnEnd: 0, steps: [], byCall: new Map(), queue: [], cur: null, curShownAt: 0, version: 0, turns: new Map(), lastSeq: -1, lastLiveAt: 0, outcome: null, subagents: 0,
        round: 0, stepField: false, afterResult: false, burst: 0, failStreak: 0, retries: 0, seenPaths: new Set(), lastFail: null, todoDone: 0 };
      const listeners = new Set(); let timer = null;
      const emit = () => { S.version++; listeners.forEach((f) => { try { f(); } catch (_e) { /* ignore */ } }); };
      function show(fr) { S.cur = fr; S.curShownAt = o.now(); fr.shownAt = S.curShownAt; }
      function arm() {
        if (timer || !S.queue.length) return;
        const wait = Math.max(0, o.dwellMs - (o.now() - S.curShownAt));
        timer = o.schedule(() => { timer = null; if (S.queue.length) { show(S.queue.shift()); emit(); } arm(); }, wait);
      }
      /** Round = LLM step inside the loop. Prefer the explicit `step` field; else count "model spoke again after a tool result". */
      function bumpRound(d) {
        if (d && typeof d.step === 'number') { S.stepField = true; if (d.step > S.round) S.round = d.step; S.afterResult = false; return; }
        if (!S.stepField && S.afterResult) { S.round++; S.afterResult = false; }
      }
      function push(fr, ctx) {
        fr.id = ++frameSeq; fr.turn = S.turn; fr.round = S.round; fr.eventTime = ctx.time; fr.recvAt = ctx.recvAt;
        if (!ctx.live) { S.queue.length = 0; S.cur = fr; S.curShownAt = 0; return; }
        const last = S.queue[S.queue.length - 1] || S.cur;
        if (last && fr.kind === 'thinking' && last.kind === 'thinking' && last.turn === fr.turn) { last.text = fr.text; return; }
        if (!S.cur || (!S.queue.length && o.now() - S.curShownAt >= o.dwellMs)) show(fr); else { S.queue.push(fr); arm(); }
      }
      function stepFor(id, tool, ctx) {
        let st = id ? S.byCall.get(id) : null; let created = false;
        if (!st) {
          st = { n: S.steps.length + 1, callId: id, tool: tool || '', raw: '', args: {}, status: 'streaming', startAt: ctx.time, recvAt: ctx.recvAt, endAt: 0, result: '', text: '' };
          S.steps.push(st); if (id) S.byCall.set(id, st); created = true;
        }
        return [st, created];
      }
      function finishStep(st) {
        const path = st.args.file_path || st.args.path;
        let state = stateForTool(st.tool, { ext: extOf(path), command: st.args.command }, compiled);
        // write to a path this session has never read/edited/written -> "create" (decided once, when the path is first known)
        if (st.tool === 'write' && path && st.isNew === undefined) st.isNew = !S.seenPaths.has(path);
        if (st.tool === 'write' && state === 'coding' && st.isNew) state = 'create';
        st.state = state; st.text = actionText(st.tool, st.args);
      }
      const sig = (st) => st.tool + '|' + (st.args.command || st.args.file_path || st.args.path || st.args.pattern || st.args.url || st.args.query || (st.args.queries && st.args.queries[0]) || '');
      function onNewStep(st, ctx) {
        S.burst++; st.round = S.round;
        if (S.lastFail && S.lastFail.sig === sig(st)) st.retry = (S.lastFail.retry || 0) + 1;
        push({ kind: 'tool', step: st, busy: S.burst >= o.busyN }, ctx);
      }
      function feed(entry, live, recvAt) {
        const ev = entry && entry.event; if (!ev || !ev.type) return;
        if (entry.type === 'event' && typeof ev.seq === 'number') { if (ev.seq <= S.lastSeq) return; S.lastSeq = ev.seq; }
        const d = ev.data || {}; const ctx = { live: !!live, time: ev.time || o.now(), recvAt: recvAt || o.now() };
        if (live) S.lastLiveAt = ctx.recvAt;
        switch (ev.type) {
          case 'turn/start': {
            S.turn = d.turn || S.turn + 1; S.active = true; S.turnStart = ctx.time; S.turnEnd = 0; S.outcome = null;
            S.steps = []; S.byCall = new Map(); S.turns.set(S.turn, { steps: S.steps, startAt: ctx.time, endAt: 0, outcome: null });
            S.lastTurnRecv = ctx.recvAt; S.round = 1; S.stepField = false; S.afterResult = false; S.burst = 0; S.failStreak = 0; S.retries = 0; S.lastFail = null; S.todoDone = 0;
            push({ kind: 'thinking', state: 'thinking', text: '正在思考…' }, ctx); break;
          }
          case 'assistant/live-chunk': {
            const c = d.chunk || {}; if (!S.active) break;
            if (c.type === 'reasoning-delta' || c.type === 'text-delta' || c.type === 'tool-call-delta') bumpRound(d);
            if (c.type === 'reasoning-delta') { S.burst = 0; push({ kind: 'thinking', state: 'thinking', text: '思考中…' }, ctx); }
            else if (c.type === 'text-delta') { S.burst = 0; push({ kind: 'thinking', state: 'thinking', text: '正在组织回复…' }, ctx); }
            else if (c.type === 'tool-call-delta') {
              const [st, created] = stepFor(c.id, c.name, ctx);
              if (c.name) st.tool = c.name; st.raw += c.argumentsDelta || ''; st.args = partialArgs(st.raw); finishStep(st);
              if (created) { st.partial = true; onNewStep(st, ctx); }
            } else return;
            break;
          }
          case 'tool/call': {
            bumpRound(d);
            const [st, created] = stepFor(d.callId, d.name, ctx);
            st.tool = d.name || st.tool; st.args = partialArgs(d.arguments); if (st.status === 'streaming') st.status = 'running'; finishStep(st);
            if (created) onNewStep(st, ctx);
            else if (S.lastFail && st.retry === undefined && S.lastFail.sig === sig(st)) st.retry = (S.lastFail.retry || 0) + 1;
            break;
          }
          case 'approval/asked': {
            const st = (d.callId && S.byCall.get(d.callId)) || S.steps.filter((x) => x.status === 'running' || x.status === 'streaming').pop();
            if (st) { st.status = 'waiting'; st.approvalId = d.id; }
            push({ kind: 'waiting', state: 'waiting', step: st, text: '等待你批准：' + clip(d.reason || (st && st.text) || d.toolName, 40) }, ctx); break;
          }
          case 'approval/decided': {
            const st = S.steps.find((x) => x.approvalId === d.id);
            if (d.outcome === 'allowed-once') { if (st) st.status = 'running'; push({ kind: 'tool', step: st, text: st ? '已批准 · ' + st.text : '已批准' }, ctx); }
            else { if (st) { st.status = 'error'; st.denied = true; st.result = d.outcome === 'rejected' ? '已拒绝' : '审批' + d.outcome; } push({ kind: 'error', state: 'denied', step: st, text: d.outcome === 'rejected' ? '你拒绝了这一步，换个办法' : '审批未通过（' + d.outcome + '）' }, ctx); }
            break;
          }
          case 'job/registered': { const st = d.toolCall && S.byCall.get(d.toolCall.callId); if (st) st.job = true; break; }
          case 'subagent/catalog': case 'tool-workflow/agent-start': {
            S.subagents++; push({ kind: 'subagent', state: 'subagents', text: '子代理「' + clip(d.label || d.name || '', 24) + '」已启动' }, ctx); break;
          }
          case 'tool/result': {
            const m = d.message || {}; const id = m.toolCallId || (m.source && m.source.callId);
            const st = S.byCall.get(id); if (!st) break;
            const failed = !!m.isError || shellFailed(st, m);
            st.status = failed ? 'error' : 'ok'; st.endAt = ctx.time; st.result = resultBrief(m) || (failed ? '失败' : '完成');
            S.afterResult = true;
            const path = st.args.file_path || st.args.path; if (path && /^(read|write|edit|str_replace_editor)$/.test(st.tool)) S.seenPaths.add(path);
            if (failed) {
              S.failStreak++; S.lastFail = { sig: sig(st), retry: st.retry || 0 };
              const worried = S.failStreak >= o.worriedN;
              push({ kind: 'error', state: worried ? 'worried' : 'error', step: st, fails: S.failStreak, text: (worried ? '又失败了（连续 ' + S.failStreak + ' 次）：' : '失败：') + st.result }, ctx);
            } else {
              S.failStreak = 0; if (S.lastFail && S.lastFail.sig === sig(st)) S.lastFail = null;
              let sub = null;
              if (/^(subagent|spawn_teammate|wait_agent|team_task_(complete|done|update))$/.test(st.tool)) sub = '子任务完成：' + clip(st.args.description || st.args.prompt || st.result, 30);
              else if (st.tool === 'todo_write' && Array.isArray(st.args.todos)) {
                const done = st.args.todos.filter((x) => x && /^(completed|done)$/i.test(x.status || '')).length;
                if (done > S.todoDone) sub = '完成一项待办（' + done + '/' + st.args.todos.length + '）';
                S.todoDone = done;
              }
              if (sub) push({ kind: 'subtask', state: 'subtask', step: st, text: sub }, ctx); else emit();
            }
            break;
          }
          case 'llm/retry': S.retries++; push({ kind: 'retry', state: 'retry', text: '模型请求失败，正在重试' + (S.retries > 1 ? '（第 ' + S.retries + ' 次）' : '') }, ctx); break;
          case 'user/interrupt': case 'turn/interrupt': case 'session/interrupt': if (S.active) push({ kind: 'interrupted', state: 'interrupted', text: '收到，马上停下…' }, ctx); break;
          case 'turn/end': {
            const k = (d.reason && d.reason.kind) || 'completed'; const ok = /^(completed|complete|stop|end_turn|done|ok)$/i.test(k);
            const cancelled = /cancel|interrupt|abort/i.test(k);
            S.active = false; S.turnEnd = ctx.time; S.outcome = ok ? 'ok' : cancelled ? 'cancelled' : 'error';
            const rec = S.turns.get(S.turn); if (rec) { rec.endAt = ctx.time; rec.outcome = S.outcome; }
            for (const st of S.steps) if (st.status === 'running' || st.status === 'streaming' || st.status === 'waiting') st.status = cancelled ? 'cancelled' : 'error';
            const long = S.turnStart && ctx.time - S.turnStart >= o.loopLongMs;
            push({ kind: ok ? 'done' : cancelled ? 'interrupted' : 'error', state: ok ? (long ? 'cheer' : 'done') : cancelled ? 'interrupted' : 'error',
              text: ok ? (long ? '终于搞定！' : '完成') + ' · 共 ' + S.steps.length + ' 步' + (S.round > 1 ? ' · ' + S.round + ' 轮' : '') + (long ? ' · 用时 ' + fmtDur(ctx.time - S.turnStart) : '') : cancelled ? '已中断' : '本轮出错（' + k + '）' }, ctx);
            break;
          }
          default: return;
        }
        if (live) emit();
      }
      function reset() { S.steps = []; S.byCall = new Map(); S.queue.length = 0; S.cur = null; S.lastSeq = -1; S.active = false; S.turns = new Map(); S.round = 0; S.burst = 0; S.failStreak = 0; S.seenPaths = new Set(); S.lastFail = null; }
      /** Current display: frame state resolved for a tool frame, live step reference. */
      function view() {
        const fr = S.cur; const now = o.now();
        let state = 'idle'; let text = '待机中'; let base = 'idle'; let mood = null; let hint = '';
        if (fr) {
          state = fr.kind === 'tool' ? (fr.step && fr.step.state) || 'tools' : fr.state;
          text = fr.text || (fr.step && fr.step.text) || '';
          base = state;
          if (fr.kind === 'tool' && fr.step && fr.step.retry) { mood = 'retry'; text = '再试一次（第 ' + (fr.step.retry + 1) + ' 次尝试）· ' + fr.step.text; }
          else if (fr.kind === 'tool' && fr.busy) mood = 'busy';
          if (fr.kind === 'tool' && fr.step && fr.step.status === 'waiting') { state = base = 'waiting'; mood = null; }
          if (mood) state = mood;
        }
        // duration escalation (live only, never over waiting/error/one-shot frames, and only for the frame that is "now")
        if (S.active && fr && !S.queue.length && (fr.kind === 'tool' || fr.kind === 'thinking')) {
          const running = fr.kind === 'thinking' || (fr.step && (fr.step.status === 'running' || fr.step.status === 'streaming'));
          const since = fr.kind === 'thinking' ? (fr.shownAt || S.curShownAt || now) : (fr.step.recvAt || fr.shownAt || now);
          const el = running ? now - since : 0; const loop = S.turnStart ? now - S.lastTurnRecv : 0;
          if (running && el >= o.stepSlowMs * 3) { state = 'tired'; mood = 'tired'; }
          else if (running && el >= o.stepSlowMs) { state = 'sweat'; mood = 'sweat'; if (fr.kind === 'thinking') text = '深度思考中…'; }
          else if (fr.kind === 'thinking' && loop >= o.loopLongMs) { state = 'tired'; mood = 'tired'; }
          if (running && el >= o.stepSlowMs / 2) hint = '已 ' + fmtDur(el);
          if (loop >= o.loopLongMs) hint = (hint ? hint + ' · ' : '') + '本轮 ' + fmtDur(loop);
        }
        if (!S.active && fr && (fr.kind === 'done' || fr.kind === 'error' || fr.kind === 'interrupted') && !S.queue.length && now - S.curShownAt > 4000 && S.curShownAt) { state = base = 'idle'; mood = null; text = '待机中'; }
        const seed = fr && fr.step ? fr.step.n : fr ? fr.round || 0 : 0;
        return { state, base, mood, hint, text, seed, round: S.round, frame: fr, active: S.active, turn: S.turn, turnStart: S.turnStart, turnEnd: S.turnEnd, steps: S.steps, queued: S.queue.length, outcome: S.outcome, failStreak: S.failStreak, version: S.version };
      }
      return { feed, reset, view, S, setRules: (r) => { compiled = compileRules(r && r.length ? r : DEFAULT_RULES); }, setDwell: (ms) => { o.dwellMs = ms; }, setTiming: (stepSec, loopSec) => { if (stepSec > 0) o.stepSlowMs = stepSec * 1000; if (loopSec > 0) o.loopLongMs = loopSec * 1000; }, subscribe: (f) => { listeners.add(f); return () => listeners.delete(f); }, emit };
    }

    // ---------------------------------------------------------------- settings store (shared by every surface)
    const LS_KEY2 = 'dsh-task-mascot:settings:v2';
    const DEFAULT_SETTINGS = { inline: true, dock: true, pet: false, pack: 'dafeiyu', size: 160, cardSize: 96, corner: 'bottom-right', pos: null, rules: null, showChip: true, opacity: 1, dwellMs: 600, sound: false, avoid: true, variants: 'alternate', stepSlowSec: 20, loopLongSec: 120 };
    function loadSettings() {
      try {
        const v2 = localStorage.getItem(LS_KEY2);
        if (v2) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(v2));
        const v1 = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); // migrate v1: `enabled` meant the floating pet
        if (v1) { const m = Object.assign({}, DEFAULT_SETTINGS, v1, { pet: v1.enabled !== false }); delete m.enabled; return m; }
      } catch (_e) { /* fallthrough */ }
      return Object.assign({}, DEFAULT_SETTINGS);
    }
    const store = { value: loadSettings(), subs: new Set() };
    function setSettings(patch) { store.value = Object.assign({}, store.value, patch); try { localStorage.setItem(LS_KEY2, JSON.stringify(store.value)); } catch (_e) { /* ignore */ } store.subs.forEach((f) => f()); }
    function useSettings() {
      const [, force] = React.useState(0);
      React.useEffect(() => { const f = () => force((n) => n + 1); store.subs.add(f); return () => store.subs.delete(f); }, []);
      return store.value;
    }
    function usePackManifest(pack) {
      const [manifest, setManifest] = React.useState(null);
      React.useEffect(() => { let ok = true; fetchManifest(pack).then((m) => { if (ok) setManifest(m); }); return () => { ok = false; }; }, [pack]);
      return manifest;
    }
    const manifests = new Map();
    function fetchManifest(pack) {
      if (!manifests.has(pack)) manifests.set(pack, fetch(API + '/asset?f=' + encodeURIComponent(pack + '/manifest.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null));
      return manifests.get(pack);
    }
    let packsPromise = null;
    function fetchPacks() { packsPromise = packsPromise || fetch(API + '/packs').then((r) => r.json()).then((j) => j.packs || []).catch(() => []); return packsPromise; }
    function assetUrl(pack, file) { return API + '/asset?f=' + encodeURIComponent(pack + '/' + file); }
    function canPlayAlphaWebm() {
      // Safari/iOS decode VP9 but drop the alpha plane -> use animated WebP there.
      const ua = navigator.userAgent || '';
      const safari = /Safari\//.test(ua) && !/(Chrome|Chromium|Edg|OPR|Firefox)\//.test(ua);
      if (safari) return false;
      const v = document.createElement('video');
      return !!v.canPlayType && v.canPlayType('video/webm; codecs="vp09.00.10.08"') !== '' || v.canPlayType('video/webm; codecs="vp9"') !== '';
    }

    // ---------------------------------------------------------------- double-buffered player
    function Player({ pack, manifest, state, size, onOneShotEnd }) {
      const aRef = React.useRef(null); const bRef = React.useRef(null);
      const front = React.useRef(0); const shown = React.useRef(null);
      const useVideo = React.useMemo(() => canPlayAlphaWebm(), []);
      const [imgSrc, setImgSrc] = React.useState(null);
      React.useEffect(() => {
        if (!manifest || !state) return;
        const entry = manifest.states[state]; if (!entry) return;
        const key = pack + '/' + state;
        if (shown.current === key) return;
        if (!useVideo) { setImgSrc(assetUrl(pack, entry.webp || entry.poster)); shown.current = key; return; }
        const vids = [aRef.current, bRef.current]; const back = vids[1 - front.current]; const cur = vids[front.current];
        if (!back) return;
        let cancelled = false;
        back.loop = entry.loop !== false; back.muted = true; back.playsInline = true;
        back.src = assetUrl(pack, entry.webm); back.poster = entry.poster ? assetUrl(pack, entry.poster) : '';
        const swap = () => {
          if (cancelled) return;
          back.play().catch(() => {}).finally(() => {
            if (cancelled) return;
            back.style.opacity = '1'; if (cur) cur.style.opacity = '0';
            front.current = 1 - front.current; shown.current = key;
            setTimeout(() => { if (cur && !cancelled) { cur.pause(); } }, 120);
          });
        };
        // Only reveal the back buffer once a frame is decoded: no blank flash between clips.
        if (back.readyState >= 2) swap(); else back.addEventListener('loadeddata', swap, { once: true });
        return () => { cancelled = true; back.removeEventListener('loadeddata', swap); };
      }, [pack, manifest, state, useVideo]);
      const vstyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', transition: 'opacity 90ms linear', pointerEvents: 'none', background: 'transparent' };
      if (!useVideo) return h('img', { src: imgSrc || '', alt: state || '', draggable: false, style: Object.assign({}, vstyle, { position: 'static' }), 'data-mascot-state': state });
      const ended = () => onOneShotEnd && onOneShotEnd();
      return h('div', { style: { position: 'relative', width: size, height: size } },
        h('video', { ref: aRef, muted: true, playsInline: true, autoPlay: true, onEnded: ended, style: Object.assign({}, vstyle, { opacity: 0 }), 'data-buf': 'a' }),
        h('video', { ref: bRef, muted: true, playsInline: true, autoPlay: true, onEnded: ended, style: Object.assign({}, vstyle, { opacity: 0 }), 'data-buf': 'b' }));
    }

    // ---------------------------------------------------------------- v2 surfaces: tracker registry, inline card, dock bar, turn summary, pet
    const STATE_ZH = { idle: '待机', thinking: '思考中', reading: '读文件', search: '搜索', coding: '写代码', editing: '改代码', writingdoc: '写文档', cmd: '跑命令', data: '跑数据', planning: '做计划', subagents: '派子代理', tools: '用工具', summary: '总结', waiting: '等你确认', done: '完成', error: '出错了',
      web: '上网', download: '下载', git: 'Git', test: '跑测试', install: '装依赖', create: '新建文件', delete: '删除', mcp: '调 MCP', memory: '翻记忆', media: '看图', diff: '对比改动',
      retry: '重试', worried: '有点慌', busy: '忙不过来', subtask: '子任务完成', denied: '被拒绝了', interrupted: '被打断', sweat: '有点久', tired: '好累', cheer: '终于搞定' };
    const STATE_ICON = { thinking: '💭', reading: '📖', search: '🔍', coding: '⌨️', editing: '✏️', writingdoc: '📝', cmd: '💻', data: '📊', planning: '🗂️', subagents: '🤝', tools: '🧰', summary: '📋', waiting: '✋', done: '✅', error: '❌', idle: '😴',
      web: '🌐', download: '⬇️', git: '🌿', test: '🧪', install: '📦', create: '🆕', delete: '🗑️', mcp: '🔌', memory: '🧠', media: '🖼️', diff: '🔀',
      retry: '🔁', worried: '😰', busy: '🌀', subtask: '☑️', denied: '🚫', interrupted: '⏸️', sweat: '💦', tired: '🥱', cheer: '🎉' };
    /** Pack state to actually play: logical -> resolved (fallbacks) -> A/B variant. */
    function displayState(v, manifest, mode) { return pickVariant(resolveState(v.state, manifest), manifest, v.seed, mode || 'alternate'); }
    const STATUS_MARK = { ok: { c: '#30a46c', m: '✓' }, error: { c: '#e5484d', m: '✗' }, waiting: { c: '#f5a524', m: '⏳' }, running: { c: '#3e63dd', m: '•' }, streaming: { c: '#8e4ec6', m: '…' }, cancelled: { c: '#888', m: '–' } };
    const ReactDOM = require('react-dom');
    const host = { ctx: null, trackers: new Map(), lastLive: null, subs: new Set() };
    const notifyHost = () => host.subs.forEach((f) => f());
    const LAT = (window.__dshMascotLatency = window.__dshMascotLatency || []);
    let actx = null;
    /** Optional short WebAudio cue (off by default): waiting = two rising notes, done = chime, error = low buzz. */
    function cue(kind) {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const t = actx.currentTime;
        const notes = kind === 'waiting' ? [[660, 0], [880, 0.14]] : kind === 'done' ? [[784, 0], [1046, 0.12]] : [[220, 0], [196, 0.16]];
        for (const [f, dt] of notes) { const o = actx.createOscillator(); const g = actx.createGain(); o.type = kind === 'error' ? 'square' : 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.08, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.18); o.connect(g).connect(actx.destination); o.start(t + dt); o.stop(t + dt + 0.2); }
      } catch (_e) { /* audio unavailable */ }
    }
    let cssDone = false;
    function ensureCss() {
      if (cssDone) return; cssDone = true;
      const st = document.createElement('style'); st.setAttribute('data-mascot-css', '');
      st.textContent = '@keyframes dshMascotIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}[data-mascot-action]{animation:dshMascotIn .18s ease-out}[data-mascot-card]{transition:border-color .2s}[data-mascot-host-in]{animation:dshMascotIn .22s ease-out}#dsh-task-mascot{transition:transform .25s ease}';
      document.head.appendChild(st);
    }
    function getTracker(sid) {
      if (!sid || !host.ctx || !host.ctx.sessions) return null;
      const have = host.trackers.get(sid); if (have) return have;
      let binding; try { binding = host.ctx.sessions.binding(sid); } catch (_e) { binding = null; }
      if (!binding || !binding.eventSource) return null;
      const sv = store.value;
      const tr = createTracker({ dwellMs: sv.dwellMs, rules: sv.rules, stepSlowMs: (sv.stepSlowSec || 20) * 1000, loopLongMs: (sv.loopLongSec || 120) * 1000 }); tr.sid = sid;
      const src = binding.eventSource;
      const replay = (w) => { tr.reset(); for (const e of w.entries || []) tr.feed(e, false); tr.emit(); };
      replay(src.getSnapshot());
      tr.unsub = src.subscribe(() => {
        const w = src.getSnapshot(); const ch = w.change || {}; const recvAt = Date.now();
        if (ch.kind === 'append') { for (const e of ch.entries || []) tr.feed(e, true, recvAt); if (host.lastLive !== tr) { host.lastLive = tr; notifyHost(); } }
        else if (ch.kind === 'replace') replay(w);
      });
      let lastCue = 0; tr.subscribe(() => { const f = tr.S.cur; if (!f || f.id === lastCue || !f.recvAt) return; lastCue = f.id; if (store.value.sound && (f.kind === 'waiting' || f.kind === 'done' || f.kind === 'error')) cue(f.kind); });
      host.trackers.set(sid, tr); notifyHost();
      return tr;
    }
    function useTracker(sid) {
      const [tr, setTr] = React.useState(() => getTracker(sid));
      React.useEffect(() => { if (tr && tr.sid === sid) return undefined; let n = 0; const iv = setInterval(() => { const t = getTracker(sid); if (t || ++n > 40) { clearInterval(iv); if (t) setTr(t); } }, 250); const t0 = getTracker(sid); if (t0) { clearInterval(iv); setTr(t0); } return () => clearInterval(iv); }, [sid]);
      return tr && tr.sid === sid ? tr : null;
    }
    function useView(tr) {
      const [, force] = React.useState(0);
      React.useEffect(() => { if (!tr) return undefined; const un = tr.subscribe(() => force((n) => n + 1)); return un; }, [tr]);
      const v = tr ? tr.view() : null;
      const live = !!(v && (v.active || v.queued || (v.turnEnd && Date.now() - v.turnEnd < 6000)));
      React.useEffect(() => { if (!live) return undefined; const iv = setInterval(() => force((n) => n + 1), 250); return () => clearInterval(iv); }, [live]);
      const s = useSettings();
      React.useEffect(() => { if (tr) { tr.setRules(s.rules); tr.setDwell(s.dwellMs || 600); tr.setTiming(s.stepSlowSec, s.loopLongSec); } }, [tr, s.rules, s.dwellMs, s.stepSlowSec, s.loopLongSec]);
      return v;
    }
    /** Record event→DOM latency once per (frame, surface). recvAt/eventTime are ms epoch; paint is the next animation frame. */
    function useLatency(v, surface, ref) {
      const fr = v && v.frame;
      React.useLayoutEffect(() => {
        if (!fr || !fr.recvAt || !fr.shownAt) return;
        const key = surface + ':' + fr.id; if (useLatency.seen.has(key)) return; useLatency.seen.add(key);
        const commit = Date.now();
        requestAnimationFrame(() => {
          const paint = Date.now();
          const rec = { surface, frame: fr.id, kind: fr.kind, state: v.state, eventToRecv: fr.eventTime ? fr.recvAt - fr.eventTime : null, queueWait: fr.shownAt - fr.recvAt, shownToCommit: commit - fr.shownAt, recvToPaint: paint - fr.recvAt, eventToPaint: fr.eventTime ? paint - fr.eventTime : null, at: paint };
          LAT.push(rec); if (LAT.length > 2000) LAT.shift();
          if (ref && ref.current) ref.current.setAttribute('data-latency', JSON.stringify(rec));
        });
      }, [fr && fr.id, surface]);
    }
    useLatency.seen = new Set();
    const fmtDur = (ms) => { ms = Math.max(0, ms | 0); const s = Math.floor(ms / 1000); return s < 60 ? (ms / 1000).toFixed(1) + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'; };
    function StepIcons({ steps, max, current }) {
      const list = steps.slice(-(max || 10));
      return h('div', { 'data-mascot-timeline': '', style: { display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' } },
        steps.length > list.length ? h('span', { style: { fontSize: 11, opacity: 0.6 } }, '+' + (steps.length - list.length)) : null,
        list.map((st) => {
          const mk = STATUS_MARK[st.status] || STATUS_MARK.running; const cur = current && current === st;
          return h('span', { key: st.n, 'data-step': st.n, 'data-status': st.status, title: '第 ' + st.n + ' 步 · ' + st.text + (st.result ? '\n→ ' + st.result : '') + (st.endAt ? '\n用时 ' + fmtDur(st.endAt - st.startAt) : ''),
            style: { position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, fontSize: 12, background: cur ? 'rgba(62,99,221,.16)' : 'rgba(127,127,127,.12)', outline: cur ? '1.5px solid #3e63dd' : 'none' } },
            STATE_ICON[st.state] || '🧰',
            h('span', { style: { position: 'absolute', right: -3, bottom: -3, fontSize: 9, lineHeight: '11px', minWidth: 11, textAlign: 'center', borderRadius: 6, color: '#fff', background: mk.c } }, mk.m));
        }));
    }
    function StepList({ steps }) {
      return h('ol', { 'data-mascot-steplist': '', style: { margin: '6px 0 0', padding: '0 0 0 18px', fontSize: 12, lineHeight: 1.6, maxHeight: 220, overflow: 'auto' } },
        steps.map((st) => h('li', { key: st.n, 'data-status': st.status, style: { color: st.status === 'error' ? '#e5484d' : 'inherit' } },
          (STATE_ICON[st.state] || '🧰') + ' ' + st.text + (st.result ? ' → ' + clip(st.result, 60) : '') + (st.endAt ? '（' + fmtDur(st.endAt - st.startAt) + '）' : st.status === 'waiting' ? '（等待批准）' : ''))));
    }
    function CardBody({ v, size, compact, manifest, pack, surface }) {
      const ref = React.useRef(null); useLatency(v, surface, ref); ensureCss();
      const [open, setOpen] = React.useState(false);
      const now = Date.now(); const fr = v.frame || {}; const st = fr.step;
      const resolved = displayState(v, manifest, useSettings().variants);
      const stepNo = st ? st.n : v.steps.length;
      const stepElapsed = st ? (st.endAt || (v.active ? now : v.turnEnd || now)) - st.startAt : 0;
      const turnElapsed = v.turnStart ? (v.active ? now : v.turnEnd || now) - v.turnStart : 0;
      const lastDone = v.steps.slice().reverse().find((x) => x.status === 'ok' || x.status === 'error');
      const tone = /^(error|worried|denied)$/.test(v.state) ? '#e5484d' : /^(waiting|interrupted|sweat|tired|retry)$/.test(v.state) ? '#f5a524' : /^(done|cheer|subtask)$/.test(v.state) ? '#30a46c' : '#3e63dd';
      return h('div', { onClick: compact ? undefined : () => setOpen((x) => !x), title: compact ? undefined : '点击展开/收起本轮全部步骤', style: { cursor: compact ? 'default' : 'pointer' } }, h('div', { ref, 'data-mascot-card': surface, 'data-state': v.state, 'data-resolved': resolved || '', 'data-step': stepNo, 'data-queued': v.queued, 'data-round': v.round || 0, 'data-mood': v.mood || '',
        style: { display: 'flex', gap: compact ? 10 : 14, alignItems: 'center', padding: compact ? '6px 10px' : '10px 14px', borderRadius: 12, border: '1px solid ' + tone + '55', background: 'var(--dsw-alias-bg-l1, rgba(127,127,127,.06))', boxShadow: '0 1px 6px rgba(0,0,0,.06)', font: '13px/1.45 system-ui, sans-serif', color: 'inherit', maxWidth: '100%' } },
        h('div', { style: { flex: 'none', width: size, height: size } }, manifest ? h(Player, { pack, manifest, state: resolved, size }) : null),
        h('div', { style: { minWidth: 0, flex: 1, display: 'flex', flexDirection: compact ? 'row' : 'column', gap: compact ? 12 : 4, alignItems: compact ? 'center' : 'stretch' } },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0, flex: compact ? '1 1 auto' : 'none' } },
            h('span', { style: { flex: 'none', fontSize: 11, padding: '0 6px', borderRadius: 8, color: '#fff', background: tone } }, STATE_ZH[v.state] || v.state),
            h('span', { key: v.text, 'data-mascot-action': '', style: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, v.text || '')),
          h('div', { style: { display: 'flex', gap: 10, fontSize: 12, opacity: 0.75, flex: 'none', whiteSpace: 'nowrap' } },
            v.round > 1 ? h('span', { 'data-mascot-round': '', title: 'Agent 循环轮次（模型第几次发言）' }, '第 ' + v.round + ' 轮') : null,
            stepNo ? h('span', { 'data-mascot-stepno': '' }, '第 ' + stepNo + ' 步') : null,
            st ? h('span', null, '本步 ' + fmtDur(stepElapsed)) : null,
            turnElapsed ? h('span', { 'data-mascot-elapsed': '' }, '总计 ' + fmtDur(turnElapsed)) : null,
            v.queued ? h('span', { title: '排队等待展示的步骤' }, '队列 ' + v.queued) : null,
            v.hint ? h('span', { 'data-mascot-hint': '', style: { opacity: 0.8, fontStyle: 'italic' } }, '⏱ ' + v.hint) : null),
          !compact && v.steps.length ? h(StepIcons, { steps: v.steps, max: 14, current: st }) : null,
          compact && v.steps.length ? h(StepIcons, { steps: v.steps, max: 8, current: st }) : null,
          !compact && lastDone ? h('div', { 'data-mascot-result': lastDone.status, style: { fontSize: 12, color: lastDone.status === 'error' ? '#e5484d' : '#30a46c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            (lastDone.status === 'error' ? '✗ ' : '✓ ') + '第 ' + lastDone.n + ' 步 ' + clip(lastDone.text, 24) + ' → ' + (lastDone.result || (lastDone.status === 'ok' ? '完成' : '失败'))) : null)),
        open && !compact && v.steps.length ? h(StepList, { steps: v.steps }) : null);
    }
    /** Align a surface to the chat column: same width as the composer card, centred. */
    function fitToColumn(el, sid) {
      if (!el) return;
      const root = document.querySelector('[data-conversation-session="' + sid + '"]') || document;
      const bar = root.querySelector('[data-slot="conversation.composer.bar"] > *') || root.querySelector('[data-slot="conversation.composer.bar"]');
      const w = bar && bar.getBoundingClientRect().width;
      if (w > 200) { el.style.maxWidth = Math.round(w) + 'px'; el.style.marginLeft = 'auto'; el.style.marginRight = 'auto'; el.style.boxSizing = 'border-box'; }
    }
    const showLive = (v) => !!v && (v.active || v.queued > 0 || (v.turnEnd && Date.now() - v.turnEnd < 4500) || (v.frame && v.frame.shownAt && Date.now() - v.frame.shownAt < 600));
    /** Inline card: portalled into the chat column right after the last row, i.e. at the active step. */
    function InlineCard({ sid }) {
      const s = useSettings(); const tr = useTracker(sid); const v = useView(tr); const manifest = usePackManifest(s.pack);
      const [el, setEl] = React.useState(null);
      const visible = s.inline && showLive(v);
      React.useEffect(() => {
        if (!visible) return undefined;
        const box = document.createElement('div'); box.setAttribute('data-mascot-inline-host', sid); box.style.cssText = 'padding:4px 0 12px;'; box.setAttribute('data-mascot-host-in', '');
        const place = () => {
          const tail = document.querySelector('[data-conversation-session="' + sid + '"] [data-chat-following-tail]');
          if (!tail) return;
          if (box.parentNode !== tail.parentNode || box.previousSibling !== tail) tail.parentNode.insertBefore(box, tail.nextSibling);
          fitToColumn(box, sid);
        };
        place(); setEl(box); const iv = setInterval(place, 500);
        return () => { clearInterval(iv); box.remove(); setEl(null); };
      }, [visible, sid]);
      if (!visible || !el || !v) return null;
      return ReactDOM.createPortal(h(CardBody, { v, size: s.cardSize || 96, manifest, pack: s.pack, surface: 'inline' }), el);
    }
    function DockBar({ sid }) {
      const s = useSettings(); const tr = useTracker(sid); const v = useView(tr); const manifest = usePackManifest(s.pack);
      const ref = React.useRef(null);
      React.useLayoutEffect(() => { fitToColumn(ref.current, sid); });
      if (!s.dock || !showLive(v)) return null;
      return h('div', { ref, 'data-mascot-dock': sid, style: { padding: '0 0 6px' } }, h(CardBody, { v, size: 40, compact: true, manifest, pack: s.pack, surface: 'dock' }));
    }
    function SessionSurfaces(props) {
      const sid = props.sid;
      return h(React.Fragment, null, h(InlineCard, { sid }), h(DockBar, { sid }));
    }
    /** Completed-turn summary in the turn's tail (data comes from the tracker's per-turn record). */
    function TurnSummary(props) {
      const s = useSettings(); const tr = useTracker(props.sid); useView(tr); const [open, setOpen] = React.useState(false);
      const turnNo = props.turn && typeof props.turn === 'object' ? props.turn.turn : props.turn;
      if (!s.inline || !tr) return null;
      const rec = tr.S.turns.get(turnNo); if (!rec || !rec.endAt || !rec.steps.length) return null;
      const ok = rec.steps.filter((x) => x.status === 'ok').length; const bad = rec.steps.filter((x) => x.status === 'error').length;
      return h('div', { 'data-mascot-turn-summary': turnNo, onClick: () => setOpen((x) => !x), title: '点击查看本轮每一步', style: { cursor: 'pointer', font: '12px system-ui, sans-serif', opacity: 0.85, padding: '4px 0' } }, h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
        h('span', null, (rec.outcome === 'ok' ? '✅' : '❌') + ' 本轮 ' + rec.steps.length + ' 步 · 用时 ' + fmtDur(rec.endAt - rec.startAt) + ' · 成功 ' + ok + (bad ? ' · 失败 ' + bad : '')),
        h(StepIcons, { steps: rec.steps, max: 24 }), h('span', { style: { opacity: 0.6 } }, open ? '收起 ▲' : '回放 ▼')),
        open ? h(StepList, { steps: rec.steps }) : null);
    }
    // ---- floating pet (follows whichever bound session produced the latest live event)
    function useActivity(useSessions) {
      const machineRef = React.useRef(null);
      if (!machineRef.current) machineRef.current = createMachine({ rules: store.value.rules });
      const m = machineRef.current;
      const settings = useSettings();
      React.useEffect(() => { m.setRules(settings.rules); }, [settings.rules]);
      const [, setTick] = React.useState(0);
      React.useEffect(() => { const iv = setInterval(() => setTick((n) => n + 1), 500); return () => clearInterval(iv); }, []);
      const status = useSessions ? useSessions((s) => {
        let running = false; let pending = null;
        for (const row of Object.values((s && s.byId) || {})) {
          const ss = row.sessionStatus || row.status || row;
          if (ss && ss.running) running = true;
          if (ss && ss.pendingInteraction) pending = ss.pendingInteraction.kind || 'pending';
        }
        return (running ? 'R' : '-') + '|' + (pending || '');
      }) : '-|';
      React.useEffect(() => { const [r, p] = String(status).split('|'); m.feedStatus({ running: r === 'R', pendingInteraction: p ? { kind: p } : null, source: 'status' }); setTick((n) => n + 1); }, [status]);
      return m.current();
    }
    function MascotOverlay(props) {
      const settings = useSettings();
      const [, force] = React.useState(0);
      React.useEffect(() => { const f = () => force((n) => n + 1); host.subs.add(f); return () => host.subs.delete(f); }, []);
      const tr = host.lastLive; const v = useView(tr);
      const coarse = useActivity(props.useSessions);
      const act = v ? { state: v.state, label: v.text } : { state: coarse.state, label: coarse.label };
      const manifest = usePackManifest(settings.pack);
      const ref = React.useRef(null); useLatency(v, 'pet', ref);
      const drag = React.useRef(null);
      const [pos, setPos] = React.useState(settings.pos);
      React.useEffect(() => { setPos(settings.pos); }, [settings.pos]);
      const [dodge, setDodge] = React.useState(0);
      React.useEffect(() => {
        if (!settings.pet || settings.avoid === false) return undefined;
        const iv = setInterval(() => {
          const me = ref.current; if (!me) return; const r = me.getBoundingClientRect(); const base = r.top - dodge;
          let need = 0;
          for (const b of document.querySelectorAll('button, [role=button], textarea, [data-composer-input]')) {
            if (me.contains(b)) continue; const q = b.getBoundingClientRect(); if (!q.width) continue;
            const hit = q.left < r.right && q.right > r.left && q.top < base + r.height && q.bottom > base;
            if (hit) need = Math.min(need, q.top - (base + r.height) - 8);
          }
          if (Math.abs(need - dodge) > 2) setDodge(Math.max(need, -base));
        }, 400);
        return () => clearInterval(iv);
      }, [settings.pet, settings.avoid, dodge]);
      if (!settings.pet || !manifest) return null;
      const resolved = v ? displayState(v, manifest, settings.variants) : resolveState(act.state, manifest);
      const size = Math.max(64, Math.min(480, settings.size | 0));
      const anchor = pos ? { left: pos.x, top: pos.y } : ({ 'bottom-right': { right: 24, bottom: 96 }, 'bottom-left': { left: 24, bottom: 96 }, 'top-right': { right: 24, top: 64 }, 'top-left': { left: 24, top: 64 } }[settings.corner] || { right: 24, bottom: 96 });
      const onDown = (e) => { if (e.button !== 0) return; const el = e.currentTarget; const r = el.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }; el.setPointerCapture(e.pointerId); };
      const onMove = (e) => { if (!drag.current) return; drag.current.moved = true; setPos({ x: Math.max(0, Math.min(window.innerWidth - size, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - size, e.clientY - drag.current.dy)) }); };
      const onUp = () => { if (drag.current && drag.current.moved && pos) setSettings({ pos }); drag.current = null; };
      return h('div', {
        id: 'dsh-task-mascot', ref, 'data-state': act.state, 'data-resolved': resolved || '', 'data-pack': settings.pack,
        onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onDoubleClick: () => setSettings({ pos: null }),
        title: (STATE_ZH[act.state] || act.state) + ' · ' + (act.label || '') + '\n拖动移动，双击归位',
        style: Object.assign({ position: 'fixed', zIndex: 2147483000, width: size, height: size, cursor: 'grab', userSelect: 'none', touchAction: 'none', opacity: settings.opacity, transform: dodge ? 'translateY(' + dodge + 'px)' : 'none' }, anchor), 'data-dodge': dodge,
      },
        h(Player, { pack: settings.pack, manifest, state: resolved, size }),
        settings.showChip ? h('div', { 'data-mascot-chip': '', style: { position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', maxWidth: size, boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', font: '12px/18px system-ui, sans-serif', padding: '0 8px', borderRadius: 9, background: act.state === 'error' ? '#e5484d' : act.state === 'waiting' ? '#f5a524' : 'rgba(30,30,40,.72)', color: '#fff', whiteSpace: 'nowrap', pointerEvents: 'none' } },
          v && v.text ? v.text : (STATE_ZH[act.state] || act.state)) : null);
    }

    // ---------------------------------------------------------------- settings section
    function SettingsSection() {
      const s = useSettings();
      const [packs, setPacks] = React.useState([]);
      React.useEffect(() => { fetchPacks().then(setPacks); }, []);
      const [rulesText, setRulesText] = React.useState(JSON.stringify(s.rules || DEFAULT_RULES, null, 2));
      const [err, setErr] = React.useState('');
      const row = (label, ctl, key) => h('label', { key, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '.5px solid var(--dsw-alias-border-l2, #ddd)', fontSize: 14 } }, h('span', null, label), ctl);
      const cb = (k) => h('input', { type: 'checkbox', 'data-setting': k, checked: !!s[k], onChange: (e) => setSettings({ [k]: e.target.checked }) });
      return h('div', { 'data-mascot-settings': '', style: { maxWidth: 640 } },
        h('h2', { style: { fontSize: 18, margin: '0 0 8px' } }, '任务状态角色 / Task Mascot'),
        h('p', { style: { fontSize: 12, opacity: 0.7, margin: '0 0 8px' } }, '角色动画实时跟随 Agent 的每一步（工具调用、思考、审批、出错、完成）。三种展示位置可任意组合。'),
        row('对话内卡片 Inline card（当前步骤处）', cb('inline')),
        row('输入框上方状态条 Input dock bar', cb('dock')),
        row('悬浮角色 Floating pet', cb('pet')),
        row('角色包 Pack', h('select', { value: s.pack, onChange: (e) => setSettings({ pack: e.target.value }) }, packs.map((p) => h('option', { key: p.id, value: p.id }, p.title || p.id)))),
        row('卡片动画大小 Card size: ' + s.cardSize + 'px', h('input', { type: 'range', min: 48, max: 200, step: 8, value: s.cardSize, onChange: (e) => setSettings({ cardSize: +e.target.value }) })),
        row('每步最短展示 Min dwell: ' + s.dwellMs + 'ms', h('input', { type: 'range', min: 0, max: 2000, step: 100, value: s.dwellMs, onChange: (e) => setSettings({ dwellMs: +e.target.value }) })),
        row('悬浮角色大小 Pet size: ' + s.size + 'px', h('input', { type: 'range', min: 64, max: 480, step: 8, value: s.size, onChange: (e) => setSettings({ size: +e.target.value }) })),
        row('悬浮位置 Pet position', h('select', { value: s.corner, onChange: (e) => setSettings({ corner: e.target.value, pos: null }) }, ['bottom-right', 'bottom-left', 'top-right', 'top-left'].map((c) => h('option', { key: c, value: c }, c)))),
        row('动作 A/B 变体 Pose variants', h('select', { 'data-setting': 'variants', value: s.variants || 'alternate', onChange: (e) => setSettings({ variants: e.target.value }) }, [['alternate', '交替 alternate'], ['random', '随机 random'], ['off', '关闭 off']].map(([k, l]) => h('option', { key: k, value: k }, l)))),
        row('单步多久算"有点久" Slow step: ' + (s.stepSlowSec || 20) + 's', h('input', { type: 'range', min: 5, max: 120, step: 5, value: s.stepSlowSec || 20, onChange: (e) => setSettings({ stepSlowSec: +e.target.value }) })),
        row('一轮多久算"好累" Long loop: ' + (s.loopLongSec || 120) + 's', h('input', { type: 'range', min: 30, max: 900, step: 30, value: s.loopLongSec || 120, onChange: (e) => setSettings({ loopLongSec: +e.target.value }) })),
        row('悬浮状态标签 Pet chip', cb('showChip')),
        row('悬浮角色自动避让按钮/审批框 Pet avoids buttons', cb('avoid')),
        row('提示音（审批/完成/出错）Sound cues', cb('sound')),
        row('悬浮不透明度 Pet opacity', h('input', { type: 'range', min: 0.3, max: 1, step: 0.05, value: s.opacity, onChange: (e) => setSettings({ opacity: +e.target.value }) })),
        h('details', { style: { marginTop: 12 } },
          h('summary', { style: { cursor: 'pointer', fontSize: 14 } }, '工具 → 动画映射（高级）Tool → state mapping (advanced)'),
          h('p', { style: { fontSize: 12, opacity: 0.7 } }, '按顺序匹配，第一个命中生效。tool/ext 是正则。可用状态：' + ALL_STATES.join(', ')),
          h('textarea', { value: rulesText, onChange: (e) => setRulesText(e.target.value), spellCheck: false, style: { width: '100%', minHeight: 240, fontFamily: 'ui-monospace, monospace', fontSize: 12 } }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('button', { type: 'button', onClick: () => { try { const r = JSON.parse(rulesText); if (!Array.isArray(r)) throw new Error('需要数组 / must be an array'); r.forEach((x) => { new RegExp(x.tool || '.*'); if (x.ext) new RegExp(x.ext); }); setSettings({ rules: r }); setErr('已保存 saved'); } catch (e) { setErr(String(e.message || e)); } } }, '保存 Save'),
            h('button', { type: 'button', onClick: () => { setSettings({ rules: null }); setRulesText(JSON.stringify(DEFAULT_RULES, null, 2)); setErr('已恢复默认 reset'); } }, '恢复默认 Reset'),
            h('span', { style: { fontSize: 12 } }, err))));
    }

    // ---------------------------------------------------------------- plugin entry
    const inject = ['slots', 'sessions'];
    function apply(ctx) {
      host.ctx = ctx;
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-task-mascot', order: 900, label: 'Task Mascot' }, MascotOverlay));
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-task-mascot', order: 80, label: () => '任务角色 Mascot' }, SettingsSection));
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-task-mascot', order: 5, inject: (sessionId) => ({ sid: sessionId }) }, SessionSurfaces));
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'dsh-task-mascot', order: 50, inject: (sessionId) => ({ sid: sessionId }) }, TurnSummary));
    }
    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = { DEFAULT_RULES, ALL_STATES, compileRules, stateForTool, resolveState, pickVariant, displayState, createMachine, createTracker, actionText, partialArgs, resultBrief, GLOBAL_FALLBACK, STATE_ZH, STATE_ICON };
    return module.exports;
  },
});
