import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeSessionEvent, listPacks, safeResolve } from '../lib/index.js';

function loadClient() {
  let mod; const sandbox = { window: { __ModuleLoader__: { load: ({ factory }) => { mod = factory((n) => (n === 'react' ? { createElement() {} } : {})); } } } };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox);
  return mod;
}
const C = loadClient(); const I = C.__internals;

test('client exports plugin entry', () => { assert.equal(typeof C.apply, 'function'); assert.deepEqual([...C.inject], ['slots', 'sessions']); });

test('default tool mapping', () => {
  const r = I.compileRules(I.DEFAULT_RULES);
  const cases = { bash: 'cmd', pwsh: 'cmd', terminal_send: 'cmd', read: 'reading', grep: 'search', glob: 'search', web_search: 'web', web_fetch: 'web', read_image: 'media', mcp__github__x: 'mcp', session_search: 'memory', create_worktree: 'git', write: 'coding', edit: 'editing', str_replace_editor: 'editing', apply_patch: 'editing', todo_write: 'planning', update_goal: 'planning', subagent: 'subagents', spawn_teammate: 'subagents', subagent_fork: 'subagents', wait_agent: 'subagents', ask_user_question: 'waiting', propose_action: 'waiting', run_code: 'data', present: 'summary', some_mcp_tool: 'tools' };
  for (const [t, s] of Object.entries(cases)) assert.equal(I.stateForTool(t, undefined, r), s, t);
  assert.equal(I.stateForTool('write', { ext: 'md' }, r), 'writingdoc');
  assert.equal(I.stateForTool('edit', { ext: 'ts' }, r), 'editing');
});

test('user override rules win and bad regex is skipped', () => {
  const r = I.compileRules([{ tool: '([', state: 'x' }, { tool: '^bash$', state: 'coding' }]);
  assert.equal(I.stateForTool('bash', undefined, r), 'coding');
  assert.equal(I.stateForTool('zzz', undefined, r), 'tools');
});

test('fallback chain resolves to existing pack states', () => {
  const m = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/manifest.json', import.meta.url), 'utf8'));
  assert.equal(I.resolveState('writingdoc', m), 'editing');
  assert.equal(I.resolveState('data', m), 'reading');
  assert.equal(I.resolveState('idle', m), 'waiting');
  assert.equal(I.resolveState('nonsense', m), 'thinking');
  for (const s of I.ALL_STATES) assert.ok(m.states[I.resolveState(s, m)], s);
});

test('state machine lifecycle + one-shot returns', () => {
  let now = 0; const m = I.createMachine({ now: () => now });
  assert.equal(m.current().state, 'idle');
  m.feed({ kind: 'turn-start' }); assert.equal(m.current().state, 'thinking');
  m.feed({ kind: 'tool-call', tool: 'bash', callId: 'a' }); assert.equal(m.current().state, 'cmd');
  m.feed({ kind: 'approval', pending: true }); assert.equal(m.current().state, 'waiting');
  m.feed({ kind: 'approval', pending: false }); assert.equal(m.current().state, 'cmd');
  m.feed({ kind: 'tool-result', callId: 'a' }); now += 2000; assert.equal(m.current().state, 'thinking');
  m.feed({ kind: 'turn-end', reason: 'completed' }); assert.equal(m.current().state, 'done');
  now += 3100; assert.equal(m.current().state, 'idle');
  m.feed({ kind: 'turn-start' }); m.feed({ kind: 'turn-end', reason: 'error' }); assert.equal(m.current().state, 'error');
  m.feed({ kind: 'turn-start' }); assert.equal(m.current().state, 'thinking', 'new turn cancels one-shot');
  m.feed({ kind: 'turn-end', reason: 'cancelled' }); assert.equal(m.current().state, 'idle');
});

test('normalizer handles real dsh 0.2.1 shapes and hides args', () => {
  const c = normalizeSessionEvent('s1', { type: 'tool/call', data: { callId: 'c1', name: 'write', arguments: '{"file_path":"/secret/NOTES.md","content":"x"}' } });
  assert.deepEqual([c.kind, c.tool, c.callId, c.args.ext], ['tool-call', 'write', 'c1', 'md']);
  assert.ok(!JSON.stringify(c).includes('secret'));
  const b = normalizeSessionEvent('s1', { type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '{"command":"cat ~/.ssh/id_rsa"}' } });
  assert.equal(b.args, undefined);
  const r = normalizeSessionEvent('s1', { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true } } });
  assert.deepEqual([r.callId, r.error], ['c1', true]);
  assert.equal(normalizeSessionEvent('s1', { type: 'turn/end', data: { reason: { kind: 'completed' } } }).reason, 'completed');
  assert.equal(normalizeSessionEvent('s1', { type: 'system/message', data: {} }), null);
});

test('asset path traversal guard + pack listing', () => {
  const root = new URL('../assets/packs', import.meta.url).pathname;
  assert.equal(safeResolve(root, '../../package.json'), null);
  assert.equal(safeResolve(root, '/etc/passwd') && !safeResolve(root, '/etc/passwd').startsWith(root), false);
  assert.ok(safeResolve(root, 'dafeiyu/done.webm'));
  assert.deepEqual(listPacks(root).map((p) => p.id), ['claude', 'dafeiyu']);
});

// ---- v2 tracker
function fakeClock() {
  let t = 1000; const timers = [];
  return { now: () => t, schedule: (fn, ms) => { timers.push({ at: t + ms, fn }); return timers.length; }, advance(ms) { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); t = x.at; x.fn(); } t = end; } };
}
const E = (type, data, seq) => ({ type: 'event', event: { type, data, seq, time: 0 } });
const chunk = (c) => ({ type: 'transient', event: { type: 'assistant/live-chunk', seq: 0, time: 0, data: { turn: 1, step: 1, chunk: c } } });

test('actionText renders Chinese action lines from args', () => {
  assert.equal(I.actionText('read', { file_path: '/a/b/README.md' }), '正在读 b/README.md');
  assert.equal(I.actionText('grep', { pattern: 'xxx', path: '.' }), '正在搜索 "xxx"');
  assert.equal(I.actionText('bash', { command: 'npm test' }), '运行 npm test');
  assert.equal(I.actionText('mcp__github__create_issue', {}), '调用 MCP: github · create_issue');
  assert.equal(I.actionText('apply_patch', { path: 'src/a.js' }), '正在改 src/a.js');
  assert.equal(I.actionText('subagent_fork', { description: '查资料' }), '派出子代理：查资料');
  assert.equal(I.actionText('propose_action', {}), '正在等你确认');
  assert.equal(I.partialArgs('{"file_path":"src/ma').file_path, undefined); // unfinished value hidden (no 'REA' flicker)
  assert.equal(I.partialArgs('{"file_path":"src/main.js","con').file_path, 'src/main.js');
  assert.equal(I.actionText('read', I.partialArgs('{"file_path":"REA')), '正在读 文件');
});

test('tracker queues every step with min dwell and handles partial calls, approval, errors, turn end', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 600, now: ck.now, schedule: ck.schedule });
  let seq = 0; const live = (e) => tr.feed(e, true, ck.now());
  live(E('turn/start', { turn: 1 }, ++seq));
  assert.equal(tr.view().state, 'thinking');
  live(chunk({ type: 'reasoning-delta', index: 0, text: 'hm' }));
  live(chunk({ type: 'tool-call-delta', index: 1, id: 'c1', name: 'read', argumentsDelta: '{"file_path":"REA' }));
  live(chunk({ type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: 'DME.md"}' }));
  live(E('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"README.md"}' }, ++seq));
  live(E('tool/result', { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'ok' }] } }, ++seq));
  live(E('tool/call', { callId: 'c2', name: 'bash', arguments: '{"command":"cat nope"}' }, ++seq));
  live(E('tool/result', { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'Error: no such file' }] } }, ++seq));
  live(E('tool/call', { callId: 'c3', name: 'bash', arguments: '{"command":"curl x"}' }, ++seq));
  live(E('approval/asked', { id: 'a1', toolName: 'bash', callId: 'c3' }, ++seq));
  // all of that arrived within 0 ms: still thinking, the rest queued
  assert.equal(tr.view().state, 'thinking'); assert.ok(tr.view().queued >= 4);
  const seen = []; for (let i = 0; i < 8; i++) { ck.advance(600); seen.push(tr.view().state); }
  assert.deepEqual(seen.slice(0, 4), ['reading', 'cmd', 'error', 'waiting'], String(seen));
  assert.ok(seen.includes('waiting'), 'approval shows waiting: ' + seen);
  assert.ok(seen.includes('error'), 'error shown: ' + seen);
  assert.equal(tr.view().steps[0].text, '正在读 README.md'); assert.equal(tr.view().steps[1].status, 'error'); assert.equal(tr.view().steps[1].result, 'no such file');
  live(E('approval/decided', { id: 'a1', outcome: 'allowed-once' }, ++seq));
  live(E('tool/result', { message: { toolCallId: 'c3', isError: false, content: 'done' } }, ++seq));
  live(E('turn/end', { turn: 1, reason: { kind: 'completed' } }, ++seq));
  ck.advance(2000); assert.equal(tr.view().state, 'done'); assert.equal(tr.view().active, false);
  assert.equal(tr.S.turns.get(1).steps.length, 3); assert.equal(tr.S.turns.get(1).outcome, 'ok');
  // duplicate durable seq ignored
  live(E('turn/start', { turn: 2 }, seq)); assert.equal(tr.view().turn, 1);
});

// ---- v2: loop understanding, tool coverage, variants, escalation
const ch = (c) => ({ type: 'transient', event: { type: 'assistant/live-chunk', seq: 0, time: 0, data: { turn: 1, chunk: c } } }); // no step field -> heuristic rounds
test('v2 bash sub-classification and write->create', () => {
  const r = I.compileRules(I.DEFAULT_RULES); const b = (c) => I.stateForTool('bash', { command: c }, r);
  const cases = { 'git status': 'git', 'git diff HEAD~1': 'diff', 'diff a b': 'diff', 'gh pr list': 'git', 'npm test': 'test', 'pnpm run test': 'test', 'cd x && pytest -q': 'test', 'node --test t.mjs': 'test',
    'npm install lodash': 'install', 'pip install -r req.txt': 'install', 'sudo apt-get install -y jq': 'install', 'curl -LO https://x/y.tgz': 'download', 'wget x': 'download',
    'rm -rf build': 'delete', 'ls -la': 'cmd', 'npm run build': 'cmd', 'echo farm': 'cmd' };
  for (const [c, s] of Object.entries(cases)) assert.equal(b(c), s, c);
  assert.equal(I.stateForTool('pwsh', { command: 'Remove-Item x' }, r), 'delete');
  assert.equal(I.stateForTool('bash', undefined, r), 'cmd');
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); let q = 0; const live = (e) => tr.feed(e, true, ck.now());
  live(E('turn/start', { turn: 1 }, ++q));
  live(E('tool/call', { callId: 'w1', name: 'write', arguments: '{"file_path":"src/new.js","content":"x"}' }, ++q)); assert.equal(tr.view().state, 'create');
  live(E('tool/result', { message: { toolCallId: 'w1', isError: false, content: 'ok' } }, ++q));
  live(E('tool/call', { callId: 'w2', name: 'write', arguments: '{"file_path":"src/new.js","content":"y"}' }, ++q)); assert.equal(tr.view().state, 'coding');
});

test('every real DSH tool maps to a state every pack can play', () => {
  const tools = ['bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'str_replace_editor', 'apply_patch', 'glob', 'grep', 'web_fetch', 'web_search', 'subagent', 'subagent_fork', 'subagent_oar', 'spawn_teammate', 'wait_agent', 'send_message', 'session_send_message', 'team_task_create', 'todo_write', 'create_goal', 'update_goal', 'ralph', 'schedule_create', 'job_output', 'terminal_send', 'user_terminal_list', 'user_terminal_read', 'session_search', 'session_event_read', 'session_event_search', 'session_event_trace', 'session_trace', 'list_session', 'list_workspace', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource', 'mcp__x__y', 'skill', 'plugin_manager', 'plugin_market', 'working_directory', 'create_worktree', 'enter_worktree', 'exit_worktree', 'load_workspace_dependencies', 'present', 'ask_user_question', 'propose_action', 'exit_plan_mode', 'lsp', 'stagehand_act', 'cordis_inspect', 'cordis_inspect_tree', 'run_code', 'office_convert', 'office_recalculate', 'office_render'];
  const r = I.compileRules(I.DEFAULT_RULES);
  for (const pack of ['dafeiyu', 'claude']) {
    const m = JSON.parse(readFileSync(new URL('../assets/packs/' + pack + '/manifest.json', import.meta.url), 'utf8'));
    for (const t of tools) { const s = I.stateForTool(t, {}, r); assert.ok(I.ALL_STATES.includes(s), t + '->' + s); assert.ok(m.states[I.resolveState(s, m)], pack + ':' + t); }
    for (const s of I.ALL_STATES) { assert.ok(m.states[I.resolveState(s, m)], pack + ':' + s); assert.ok(I.STATE_ZH[s], 'zh ' + s); }
  }
  const d = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/manifest.json', import.meta.url), 'utf8'));
  for (const s of ['web', 'download', 'git', 'test', 'install', 'create', 'delete', 'mcp', 'memory', 'media', 'diff', 'retry', 'worried', 'busy', 'subtask', 'denied', 'interrupted', 'sweat', 'tired', 'cheer']) assert.equal(I.resolveState(s, d), s, 'dafeiyu has ' + s);
  const c = JSON.parse(readFileSync(new URL('../assets/packs/claude/manifest.json', import.meta.url), 'utf8'));
  assert.equal(I.resolveState('web', c), 'search'); assert.equal(I.resolveState('cheer', c), 'done'); assert.equal(I.resolveState('git', c), 'cmd');
});

test('A/B variants alternate / random / off and ignore packs without them', () => {
  const m = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual([1, 2, 3, 4].map((n) => I.pickVariant('coding', m, n, 'alternate')), ['coding_b', 'coding', 'coding_b', 'coding']);
  assert.equal(I.pickVariant('coding', m, 7, 'off'), 'coding');
  const rnd = new Set(Array.from({ length: 40 }, (_, n) => I.pickVariant('reading', m, n, 'random'))); assert.deepEqual([...rnd].sort(), ['reading', 'reading_b']);
  assert.equal(I.pickVariant('reading', m, 5, 'random'), I.pickVariant('reading', m, 5, 'random'), 'deterministic');
  assert.equal(I.pickVariant('git', m, 1, 'alternate'), 'git');
  const c = JSON.parse(readFileSync(new URL('../assets/packs/claude/manifest.json', import.meta.url), 'utf8'));
  assert.equal(I.pickVariant('coding', c, 1, 'alternate'), 'coding');
  assert.equal(I.displayState({ state: 'web', seed: 1 }, c, 'alternate'), 'search');
});

test('loop understanding: rounds, retry, worried, busy, subtask, denied, interrupted', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); let q = 0; const live = (e) => tr.feed(e, true, ck.now());
  const call = (id, name, args) => live(E('tool/call', { callId: id, name, arguments: JSON.stringify(args) }, ++q));
  const res = (id, err, text) => live(E('tool/result', { message: { toolCallId: id, isError: !!err, content: text || 'ok' } }, ++q));
  live(E('turn/start', { turn: 1 }, ++q)); assert.equal(tr.view().round, 1);
  live(ch({ type: 'reasoning-delta', text: 'a' }));
  call('a', 'bash', { command: 'npm test' }); assert.equal(tr.view().state, 'test');
  res('a', true, 'Error: 3 failing'); assert.equal(tr.view().state, 'error'); assert.equal(tr.view().failStreak, 1);
  live(ch({ type: 'reasoning-delta', text: 'b' })); assert.equal(tr.view().round, 2, 'model spoke again after a result -> round 2');
  call('b', 'bash', { command: 'npm test' }); assert.equal(tr.view().state, 'retry'); assert.match(tr.view().text, /再试一次（第 2 次尝试）/); assert.equal(tr.view().base, 'test');
  res('b', true, 'Error: 1 failing'); assert.equal(tr.view().state, 'worried'); assert.match(tr.view().text, /连续 2 次/);
  live(ch({ type: 'reasoning-delta', text: 'c' }));
  call('c', 'bash', { command: 'npm test' }); res('c', false); assert.equal(tr.view().failStreak, 0);
  // busy: 5 tool calls in a row without the model thinking in between
  for (let i = 0; i < 5; i++) { call('r' + i, 'read', { file_path: 'f' + i + '.js' }); }
  assert.equal(tr.view().state, 'busy'); assert.equal(tr.view().base, 'reading');
  for (let i = 0; i < 5; i++) res('r' + i, false);
  live(ch({ type: 'text-delta', text: 'x' })); call('s', 'subagent', { description: '查资料' }); assert.equal(tr.view().state, 'subagents');
  res('s', false, 'found'); assert.equal(tr.view().state, 'subtask'); assert.match(tr.view().text, /子任务完成：查资料/);
  call('t', 'todo_write', { todos: [{ status: 'completed' }, { status: 'pending' }] }); res('t', false); assert.match(tr.view().text, /完成一项待办（1\/2）/);
  call('d', 'bash', { command: 'rm -rf /tmp/x' }); assert.equal(tr.view().state, 'delete');
  live(E('approval/asked', { id: 'ap', callId: 'd' }, ++q)); assert.equal(tr.view().state, 'waiting');
  live(E('approval/decided', { id: 'ap', outcome: 'rejected' }, ++q)); assert.equal(tr.view().state, 'denied');
  live(E('llm/retry', {}, ++q)); assert.equal(tr.view().state, 'retry');
  live(E('llm/retry', {}, ++q)); assert.match(tr.view().text, /第 2 次/);
  live(E('turn/end', { reason: { kind: 'cancelled' } }, ++q)); assert.equal(tr.view().state, 'interrupted'); assert.equal(tr.view().text, '已中断');
  ck.advance(5000); assert.equal(tr.view().state, 'idle');
  // explicit step field wins over the heuristic
  live(E('turn/start', { turn: 2 }, ++q)); live(E('tool/call', { turn: 2, step: 4, callId: 'z', name: 'read', arguments: '{}' }, ++q)); assert.equal(tr.view().round, 4);
});

test('duration escalation: sweat -> tired per step, tired on long loop, cheer on long success, elapsed hint', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule, stepSlowMs: 20000, loopLongMs: 120000 }); let q = 0; const live = (e) => tr.feed(e, true, ck.now());
  live(E('turn/start', { turn: 1 }, ++q));
  live(E('tool/call', { callId: 'a', name: 'bash', arguments: '{"command":"make"}' }, ++q));
  ck.advance(9000); assert.equal(tr.view().state, 'cmd'); assert.equal(tr.view().hint, '');
  ck.advance(2000); assert.equal(tr.view().state, 'cmd'); assert.match(tr.view().hint, /^已 11\.0s$/);
  ck.advance(10000); assert.equal(tr.view().state, 'sweat'); assert.equal(tr.view().base, 'cmd');
  ck.advance(40000); assert.equal(tr.view().state, 'tired');
  live(E('tool/result', { message: { toolCallId: 'a', isError: false, content: 'ok' } }, ++q));
  assert.equal(tr.view().state, 'cmd', 'finished step stops escalating');
  live(ch({ type: 'reasoning-delta', text: 'x' })); assert.equal(tr.view().state, 'thinking');
  ck.advance(25000); assert.equal(tr.view().state, 'sweat'); assert.equal(tr.view().text, '深度思考中…');
  live(ch({ type: 'text-delta', text: 'x' })); // merged into the same thinking frame -> still timing from first shown
  ck.advance(50000); assert.match(tr.view().hint, /本轮 2m/); 
  live(E('tool/call', { callId: 'b', name: 'read', arguments: '{}' }, ++q)); live(E('tool/result', { message: { toolCallId: 'b', isError: false, content: 'ok' } }, ++q));
  live(ch({ type: 'reasoning-delta', text: 'y' })); assert.equal(tr.view().state, 'tired', 'long loop + thinking -> tired');
  live(E('turn/end', { reason: { kind: 'completed' } }, ++q)); assert.equal(tr.view().state, 'cheer'); assert.match(tr.view().text, /终于搞定！ · 共 2 步 · 3 轮 · 用时 2m/);
  const t2 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); t2.feed(E('turn/start', { turn: 1 }, 1), true); t2.feed(E('turn/end', { reason: { kind: 'completed' } }, 2), true); assert.equal(t2.view().state, 'done');
  // tunable
  const t3 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); t3.setTiming(5, 60); t3.feed(E('turn/start', { turn: 1 }, 1), true, ck.now()); t3.feed(E('tool/call', { callId: 'q', name: 'grep', arguments: '{}' }, 2), true, ck.now()); ck.advance(6000); assert.equal(t3.view().state, 'sweat');
});

test('v2: non-zero shell exit counts as failure (retry -> worried), diff exit does not', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); let q = 0; const live = (e) => tr.feed(e, true, ck.now());
  const call = (id, command, out) => {
    live(E('tool/call', { callId: id, name: 'bash', arguments: JSON.stringify({ command }) }, ++q));
    live(E('tool/result', { message: { toolCallId: id, isError: false, content: [{ type: 'text', text: out }] } }, ++q));
    return tr.view();
  };
  live(E('turn/start', { turn: 1 }, ++q));
  let v = call('a', 'node --test x.mjs', '[stderr]\nCould not find x\n[exit code: 1]');
  assert.equal(v.state, 'error'); assert.match(v.text, /Could not find x/);
  live(E('tool/call', { callId: 'b0', name: 'bash', arguments: JSON.stringify({ command: 'node --test x.mjs' }) }, ++q));
  assert.equal(tr.view().state, 'retry');
  live(E('tool/result', { message: { toolCallId: 'b0', isError: false, content: [{ type: 'text', text: 'boom\n[exit code: 1]' }] } }, ++q));
  assert.equal(tr.view().state, 'worried');
  v = call('c', 'diff a b', '1c1\n[exit code: 1]');
  assert.equal(v.state, 'diff');
  assert.equal(call('d', 'ls', 'x\n[exit code: 0]').state, 'cmd');
});

test('dex: 33 public entries map to real states and unlock once', () => {
  const m = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/dex/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.entries.length, 33); assert.equal(m.private, false);
  for (const e of m.entries) { assert.ok(I.ALL_STATES.includes(e.id), e.id); for (const k of ['lit', 'lit@2x', 'locked', 'locked@2x']) assert.ok(readFileSync(new URL('../assets/packs/dafeiyu/dex/' + e[k], import.meta.url)).length > 0); }
  I.dex.m = m; I.dexLit().clear();
  assert.equal(I.dexUnlock('coding', { silent: true }), true);
  assert.equal(I.dexUnlock('coding', { silent: true }), false);
  assert.equal(I.dexUnlock('idle', { silent: true }), false);
});

test('2.1.1: dock bar does not duplicate a visible inline card (auto by default)', () => {
  assert.equal(I.DEFAULT_SETTINGS.dockMode, 'auto');
  const base = { dock: true, inline: true, dockMode: 'auto', live: true };
  assert.equal(I.dockShouldShow({ ...base, inlineInView: true }), false, 'inline card on screen -> no dock bar');
  assert.equal(I.dockShouldShow({ ...base, inlineInView: false }), true, 'inline card scrolled away / missing -> dock bar');
  assert.equal(I.dockShouldShow({ ...base, inline: false, inlineInView: false }), true, 'inline surface off -> dock bar');
  assert.equal(I.dockShouldShow({ ...base, dockMode: 'always', inlineInView: true }), true, 'always = old behaviour');
  assert.equal(I.dockShouldShow({ ...base, dockMode: undefined, inlineInView: true }), false, 'saved settings without dockMode behave as auto');
  assert.equal(I.dockShouldShow({ ...base, dock: false, inlineInView: false }), false);
  assert.equal(I.dockShouldShow({ ...base, live: false, inlineInView: false }), false);
});

test('2.1.1: several unlocks merge into one toast line', () => {
  const m = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/dex/manifest.json', import.meta.url), 'utf8'));
  const one = I.dexToastText([m.entries[1]]);
  assert.match(one.title, /^新解锁！#\d\d$/); assert.equal(one.line, m.entries[1].label);
  const many = I.dexToastText(m.entries.slice(0, 6));
  assert.equal(many.title, '新解锁 ×6'); assert.ok(many.line.endsWith(' 等')); assert.equal(many.line.split('、').length, 4);
  for (const e of m.entries) for (const k of ['lit', 'lit@2x']) assert.ok(e[k], e.id + ' ' + k);
});

test('0.2.2-rc.2: each new tool name maps to a specific state (not generic tools)', () => {
  const r = I.compileRules(I.DEFAULT_RULES);
  const cases = {
    apply_patch: 'editing',
    subagent_fork: 'subagents',
    subagent_oar: 'subagents',
    wait_agent: 'subagents',
    user_terminal_list: 'reading',
    user_terminal_read: 'reading',
    list_mcp_resource_templates: 'mcp',
    office_convert: 'writingdoc',
    office_recalculate: 'data',
    office_render: 'writingdoc',
    propose_action: 'waiting',
    spawn_teammate: 'subagents',
  };
  for (const [t, s] of Object.entries(cases)) assert.equal(I.stateForTool(t, undefined, r), s, t);
  assert.equal(I.stateForTool('apply_patch', { ext: 'md' }, r), 'writingdoc');
  assert.equal(I.stateForTool('apply_patch', { ext: 'ts' }, r), 'editing');
  assert.equal(I.toolPath({ input: '*** Update File: docs/README.md\n@@\n-a\n+b\n' }), 'docs/README.md');
  assert.equal(I.actionText('apply_patch', { input: '*** Update File: docs/README.md\n@@\n-a\n+b\n' }), '正在改 docs/README.md');
  assert.equal(I.actionText('subagent_oar', { description: '用 Codex 改' }), '派出子代理：用 Codex 改');
  assert.equal(I.actionText('wait_agent', {}), '等子代理回来');
  assert.equal(I.actionText('user_terminal_list', {}), '正在查看终端列表');
  assert.equal(I.actionText('user_terminal_read', { terminal: 'bash-1' }), '正在读终端输出 bash-1');
  assert.equal(I.actionText('list_mcp_resource_templates', {}), '列出 MCP 资源模板');
  assert.equal(I.actionText('office_convert', { path: 'a.docx' }), '正在转换文档 a.docx');
  assert.equal(I.actionText('office_recalculate', { path: 'b.xlsx' }), '正在重算表格 b.xlsx');
  assert.equal(I.actionText('office_render', { path: 'c.pptx' }), '正在渲染文档 c.pptx');
});

test('0.2.3-alpha.2: new tool names map to specific states (not generic tools)', () => {
  const r = I.compileRules(I.DEFAULT_RULES);
  const cases = {
    cordis_inspect: 'reading',
    cordis_inspect_tree: 'reading',
    cordis_inspect_list: 'reading',
    enter_worktree: 'git',
    exit_worktree: 'git',
    create_worktree: 'git',
    session_send_message: 'subagents',
    list_session: 'memory',
    list_workspace: 'memory',
    session_search: 'memory',
    session_read: 'memory',
    session_list: 'memory',
    working_directory: 'tools',
    propose_action: 'waiting',
  };
  for (const [t, st] of Object.entries(cases)) assert.equal(I.stateForTool(t, undefined, r), st, t);
  assert.notEqual(I.stateForTool('session_send_message', undefined, r), 'memory', 'must not reuse session_* memory rule');
  assert.equal(I.stateForTool('session_event_read', undefined, r), 'memory');
  assert.equal(I.stateForTool('session_event_search', undefined, r), 'memory');
  assert.equal(I.stateForTool('session_trace', undefined, r), 'memory');
  assert.equal(I.actionText('cordis_inspect', {}), '正在查看插件');
  assert.equal(I.actionText('cordis_inspect', { query: { platform: 'host', provider: 'dsh', method: 'tools' } }), '正在查看插件 host · dsh · tools');
  assert.equal(I.actionText('cordis_inspect_tree', { name: 'dsh-task-mascot' }), '正在查看插件 dsh-task-mascot');
  assert.equal(I.actionText('enter_worktree', { name: 'fix-login-retry' }), '进入 worktree fix-login-retry');
  assert.equal(I.actionText('exit_worktree', {}), '离开 worktree');
  assert.equal(I.actionText('create_worktree', { path: 'wt/old' }), '新建 Git worktree wt/old');
  assert.equal(I.actionText('session_send_message', { session_id: 's-1', message: '请继续' }), '给其他会话发消息 s-1');
  assert.equal(I.actionText('session_send_message', {}), '给其他会话发消息');
  assert.equal(I.actionText('list_session', { workspace_id: 'ws-1' }), '翻看会话列表 ws-1');
  assert.equal(I.actionText('list_workspace', {}), '翻看工作区列表');
  assert.equal(I.actionText('session_search', { query: 'old' }), '翻看历史会话 "old"');
});

test('0.2.3-alpha.2: fixture replay maps new tools and keeps rc.5 names', () => {
  const FIX_A = JSON.parse(readFileSync(new URL('./fixtures/alpha2-tool-calls.json', import.meta.url), 'utf8'));
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  const seen = [];
  for (const e of FIX_A.entries) {
    tr.feed(e, true, ck.now());
    const typ = e.event && e.event.type;
    if (typ === 'tool/call') {
      const st = tr.view().steps.at(-1);
      seen.push({ tool: e.event.data.name, state: st.state, text: st.text });
    }
  }
  assert.deepEqual(seen, [
    { tool: 'cordis_inspect', state: 'reading', text: '正在查看插件' },
    { tool: 'enter_worktree', state: 'git', text: '进入 worktree fix-login-retry' },
    { tool: 'exit_worktree', state: 'git', text: '离开 worktree' },
    { tool: 'session_send_message', state: 'subagents', text: '给其他会话发消息 s-42' },
    { tool: 'list_session', state: 'memory', text: '翻看会话列表' },
    { tool: 'list_workspace', state: 'memory', text: '翻看工作区列表' },
    { tool: 'cordis_inspect_tree', state: 'reading', text: '正在查看插件' },
    { tool: 'create_worktree', state: 'git', text: '新建 Git worktree wt/legacy' },
    { tool: 'session_search', state: 'memory', text: '翻看历史会话 "login bug"' },
  ]);
  const dex = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/dex/manifest.json', import.meta.url), 'utf8'));
  assert.equal(dex.entries.length, 33);
  const byId = Object.fromEntries(dex.entries.map((e) => [e.id, e]));
  assert.match(byId.reading.trigger, /cordis_inspect/);
  assert.match(byId.git.trigger, /enter_worktree/);
  assert.match(byId.git.trigger, /exit_worktree/);
  assert.match(byId.memory.trigger, /list_session/);
  assert.doesNotMatch(byId.memory.trigger, /session_\*/);
  assert.match(byId.subagents.trigger, /session_send_message/);
});

test('0.2.2-rc.2: apply_patch path from patch body and sandbox deny is a failure', () => {
  const ck = (() => { let n = 0, timers = []; return { now: () => n, schedule: (fn, ms) => { const id = { at: n + ms, fn }; timers.push(id); return id; }, advance: (ms) => { n += ms; const due = timers.filter((t) => t.at <= n); timers = timers.filter((t) => t.at > n); due.forEach((t) => t.fn()); } }; })();
  // Prefer the repo's fakeClock if the previous tests defined helpers we can reuse via a compact inline clock.
  const E = (type, data, seq) => ({ type: 'event', event: { type, seq, time: ck.now(), data } });
  const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  let q = 0;
  tr.feed(E('turn/start', { turn: 1 }, ++q), true, ck.now());
  tr.feed(E('tool/call', { callId: 'p1', name: 'apply_patch', arguments: JSON.stringify({ input: '*** Update File: src/app.ts\n@@\n-a\n+b\n' }) }, ++q), true, ck.now());
  assert.equal(tr.view().state, 'editing');
  assert.equal(tr.view().steps[0].text, '正在改 src/app.ts');
  tr.feed(E('tool/result', { message: { toolCallId: 'p1', isError: false, content: 'ok' } }, ++q), true, ck.now());
  tr.feed(E('tool/call', { callId: 'p2', name: 'apply_patch', arguments: JSON.stringify({ input: '*** Update File: notes.md\n@@\n-a\n+b\n' }) }, ++q), true, ck.now());
  assert.equal(tr.view().state, 'writingdoc');
  tr.feed(E('tool/result', { message: { toolCallId: 'p2', isError: false, content: 'ok' } }, ++q), true, ck.now());
  tr.feed(E('tool/call', { callId: 'p3', name: 'subagent_fork', arguments: JSON.stringify({ description: '查一下' }) }, ++q), true, ck.now());
  assert.equal(tr.view().state, 'subagents');
  tr.feed(E('tool/result', { message: { toolCallId: 'p3', isError: false, content: 'done' } }, ++q), true, ck.now());
  tr.feed(E('tool/call', { callId: 'p4', name: 'propose_action', arguments: '{}' }, ++q), true, ck.now());
  assert.equal(tr.view().state, 'waiting');
  assert.equal(I.shellFailed({ tool: 'bash', args: { command: 'cat /etc/shadow' } }, { content: '[sandbox: file access denied under workspace mode]\n' }), true);
  assert.equal(I.shellFailed({ tool: 'bash', args: { command: 'ls' } }, { content: 'ok\n[exit code: 0]' }), false);
  tr.feed(E('tool/call', { callId: 'p5', name: 'bash', arguments: JSON.stringify({ command: 'cat secret.txt' }) }, ++q), true, ck.now());
  tr.feed(E('tool/result', { message: { toolCallId: 'p5', isError: false, content: [{ type: 'text', text: '[sandbox: file access denied under workspace mode]\n' }] } }, ++q), true, ck.now());
  assert.equal(tr.view().state, 'error');
});

test('0.2.2-rc.5: CONTENT_REFUSED is a model refusal, not a generic error', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); let q = 0;
  const live = (e) => tr.feed(e, true, ck.now());
  assert.equal(I.turnErrorCode({ reason: { kind: 'error', error: { code: 'CONTENT_REFUSED', message: 'DeepSeek refused to answer under its content safety review' } } }), 'CONTENT_REFUSED');
  assert.equal(I.turnErrorCode({ reason: { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad' } } }), 'MALFORMED_RESPONSE');
  assert.equal(I.turnErrorCode({ reason: { kind: 'completed' } }), '');
  assert.equal(I.resolveState('refused', JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/manifest.json', import.meta.url), 'utf8'))), 'worried');
  live(E('turn/start', { turn: 1 }, ++q));
  live(E('turn/end', { reason: { kind: 'error', error: { code: 'CONTENT_REFUSED', message: 'DeepSeek refused to answer under its content safety review' } } }, ++q));
  assert.equal(tr.view().state, 'refused');
  assert.equal(tr.view().text, '模型拒绝回答这个请求');
  assert.equal(tr.view().outcome, 'refused');
  assert.equal(tr.S.cur.kind, 'refused', 'kind is not error, so the error sound does not play');
  // old MALFORMED_RESPONSE and other LLM errors stay generic
  const t2 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  t2.feed(E('turn/start', { turn: 1 }, 1), true, ck.now());
  t2.feed(E('turn/end', { reason: { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad stream' } } }, 2), true, ck.now());
  assert.equal(t2.view().state, 'error');
  assert.match(t2.view().text, /本轮出错（error）/);
  assert.equal(t2.S.cur.kind, 'error');
  const t3 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  t3.feed(E('turn/start', { turn: 1 }, 1), true, ck.now());
  t3.feed(E('turn/end', { reason: { kind: 'error' } }, 2), true, ck.now());
  assert.equal(t3.view().state, 'error');
  // a normal tool turn still ends with 完成
  const t4 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  t4.feed(E('turn/start', { turn: 1 }, 1), true, ck.now());
  t4.feed(E('tool/call', { callId: 'r1', name: 'read', arguments: '{"file_path":"README.md"}' }, 2), true, ck.now());
  assert.equal(t4.view().state, 'reading');
  t4.feed(E('tool/result', { message: { toolCallId: 'r1', isError: false, content: 'ok' } }, 3), true, ck.now());
  t4.feed(E('turn/end', { reason: { kind: 'completed' } }, 4), true, ck.now());
  assert.equal(t4.view().state, 'done');
  assert.match(t4.view().text, /完成 · 共 1 步/);
});

// ---------------------------------------------------------------- 2.2.0: agent checklist + turn cost
const FIX = JSON.parse(readFileSync(new URL('./fixtures/rc5-todo-turn.json', import.meta.url), 'utf8'));

test('2.2.0: real rc.5 todo/write turn -> checklist, check-off bubble, wrap-up of unfinished item', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  const texts = [];
  for (const e of FIX.entries) { tr.feed(e, true, ck.now()); const t = tr.S.cur && tr.S.cur.text; if (t && texts[texts.length - 1] !== t) texts.push(t); }
  assert.ok(texts.includes('接到 3 件事：读 README → 修改 lib/client.js → 跑单元测试'), texts.join(' | '));
  assert.ok(texts.includes('勾掉 2 项 ✓ 修改 lib/client.js（2/3）'), texts.join(' | '));
  assert.ok(!texts.some((t) => /完成一项待办/.test(t)), 'tool/result fallback stays quiet once todo/write events are seen');
  const v = tr.view();
  assert.equal(v.state, 'done'); assert.equal(v.outcome, 'ok');
  assert.equal(v.text, '这轮先到这：还剩「跑单元测试」没做');
  assert.equal(v.plan.items.map((x) => x.status).join(','), 'completed,completed,pending');
  assert.equal(v.wrap.left.join('|'), '跑单元测试'); assert.equal(v.wrap.done, 2); assert.equal(v.wrap.total, 3); assert.equal(v.wrap.fails.length, 0);
  // usage: 4 model calls, deepseek-official/deepseek-flash, Beijing Mon 10:31 = peak
  assert.equal(v.usage.calls, 4); assert.equal(v.usage.total, 2060 * 3 + 2520); assert.equal(v.usage.cacheRead, 800 * 3 + 1000);
  assert.ok(Math.abs(v.usage.cost - 0.011936) < 1e-9, String(v.usage.cost));
  assert.equal(I.costPhrase(v.usage), '约 ¥0.01');
  const rec = tr.S.turns.get(1); assert.equal(rec.wrap.left[0], '跑单元测试'); assert.equal(rec.usage.calls, 4); assert.equal(rec.plan.items.length, 3);
});

test('2.2.0: history replay rebuilds the same plan/usage without live bubbles', () => {
  const tr = I.createTracker({ dwellMs: 0 });
  for (const e of FIX.entries) tr.feed(e, false);
  const v = tr.view();
  assert.equal(v.wrap.left.length, 1); assert.equal(v.usage.calls, 4); assert.equal(v.plan.writes, 2);
});

test('2.2.0: costShow always appends the estimate; threshold hides small turns; off hides it', () => {
  for (const [mode, re] of [['always', / · 约 ¥0\.01$/], ['threshold', /没做$/], ['off', /没做$/]]) {
    const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule, costShow: mode });
    for (const e of FIX.entries) tr.feed(e, true, ck.now());
    assert.match(tr.view().text, re, mode);
  }
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule, costThreshold: 0.01 });
  for (const e of FIX.entries) tr.feed(e, true, ck.now());
  assert.match(tr.view().text, / · 约 ¥0\.01$/, 'threshold reached');
});

test('2.2.0: pricing table, peak/idle, non-DeepSeek routes show tokens only', () => {
  const J = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(J(I.priceFor('deepseek-official', 'deepseek-flash')), { hit: 0.04, miss: 2, out: 8 });
  assert.deepEqual(J(I.priceFor('deepseek-account', 'deepseek-v4-pro')), { hit: 0.3, miss: 9, out: 27 });
  assert.deepEqual(I.priceFor('deepseek-official', 'deepseek-v4-flash-vision-exp'), I.DEEPSEEK_PRICES['deepseek-flash']);
  assert.equal(I.priceFor('openai', 'deepseek-flash'), null);
  assert.equal(I.priceFor('deepseek-official', 'some-new-model'), null);
  const mon1030 = Date.UTC(2026, 10, 23, 2, 30); const mon1230 = Date.UTC(2026, 10, 23, 4, 30); const sat1030 = Date.UTC(2026, 10, 21, 2, 30);
  assert.equal(I.isPeakCN(mon1030), true); assert.equal(I.isPeakCN(mon1230), false); assert.equal(I.isPeakCN(sat1030), false);
  const u = { inputTokens: 1e6, cacheReadTokens: 1e6, outputTokens: 1e6 };
  assert.ok(Math.abs(I.estimateCost(u, 'deepseek-official', 'deepseek-flash', mon1030) - 10.04) < 1e-9);
  assert.ok(Math.abs(I.estimateCost(u, 'deepseek-official', 'deepseek-flash', sat1030) - 5.02) < 1e-9);
  const other = I.addUsage(I.newUsage(), { inputTokens: 20000, outputTokens: 1000, totalTokens: 21000 }, 'pi-ai', 'gpt-x', mon1030);
  assert.equal(I.costPhrase(other), '用了 2.1 万 token');
  const mixed = I.addUsage(I.addUsage(I.newUsage(), { inputTokens: 10, outputTokens: 1 }, 'deepseek-official', 'deepseek-flash', mon1030), { inputTokens: 10, outputTokens: 1 }, 'pi-ai', 'x', mon1030);
  assert.match(I.costPhrase(mixed), /token$/, 'any unpriced call -> tokens only, never a partial ¥');
  assert.equal(I.fmtCost(0.004), '不到 ¥0.01'); assert.equal(I.fmtCost(0.31), '约 ¥0.31'); assert.equal(I.costPhrase(I.newUsage()), '');
});

test('2.2.0: all items checked -> 清单全勾 (dex #33), plays cheer', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); let q = 0;
  const live = (t, d) => tr.feed(E(t, d, ++q), true, ck.now());
  live('turn/start', { turn: 1 });
  live('todo/write', { todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] });
  assert.equal(tr.view().state, 'planning');
  live('todo/write', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] });
  assert.equal(tr.view().text, '勾掉一项 ✓ A（1/2）'); assert.equal(tr.view().state, 'subtask');
  live('todo/write', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'completed' }] });
  live('turn/end', { turn: 1, reason: { kind: 'completed' } });
  assert.equal(tr.view().state, 'allclear'); assert.equal(tr.view().text, '全部搞定 2/2 ✓'); assert.equal(tr.S.cur.kind, 'done');
  const pm = JSON.parse(readFileSync(new URL('../assets/packs/dafeiyu/manifest.json', import.meta.url), 'utf8'));
  assert.equal(I.resolveState('allclear', pm), 'cheer');
  assert.equal(I.STATE_ZH.allclear, '清单全勾');
});

test('2.2.0: failure inference, retries that recovered are not reported; interrupt / max-tokens list what is left', () => {
  const ck = fakeClock(); const tr = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule }); let q = 0;
  const live = (t, d) => tr.feed(E(t, d, ++q), true, ck.now());
  live('turn/start', { turn: 1 });
  live('todo/write', { todos: [{ content: '修 bug', status: 'in_progress' }, { content: '跑测试', status: 'pending' }] });
  live('tool/call', { callId: 'b1', name: 'bash', arguments: JSON.stringify({ command: 'npm run build' }) });
  live('tool/result', { message: { toolCallId: 'b1', isError: true, content: 'boom' } });
  live('tool/call', { callId: 'b2', name: 'bash', arguments: JSON.stringify({ command: 'npm run build' }) });
  live('tool/result', { message: { toolCallId: 'b2', isError: false, content: 'ok\n[exit code: 0]' } });
  live('tool/call', { callId: 't1', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) });
  live('tool/result', { message: { toolCallId: 't1', isError: true, content: 'fail' } });
  live('tool/call', { callId: 't2', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) });
  live('tool/result', { message: { toolCallId: 't2', isError: true, content: 'fail' } });
  live('todo/write', { todos: [{ content: '修 bug', status: 'completed' }, { content: '跑测试', status: 'in_progress' }] });
  live('turn/end', { turn: 1, reason: { kind: 'completed' } });
  const w = tr.view().wrap;
  assert.equal(w.fails.length, 1); assert.equal(w.fails[0].n, 2); assert.equal(w.fails[0].text, '运行 npm test');
  assert.equal(tr.view().text, '这轮先到这：还剩「跑测试」没做 · 运行 npm test 失败 2 次');
  // interrupted
  const t2 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  t2.feed(E('turn/start', { turn: 1 }, 1), true, ck.now());
  t2.feed(E('todo/write', { todos: [{ content: '改 client.js', status: 'in_progress' }, { content: '跑测试', status: 'pending' }] }, 2), true, ck.now());
  t2.feed(E('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user' } }, 3), true, ck.now());
  assert.equal(t2.view().state, 'interrupted'); assert.equal(t2.view().text, '已中断 · 还剩 2 项没做：改 client.js、跑测试');
  // max-tokens
  const t3 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule });
  t3.feed(E('turn/start', { turn: 1 }, 1), true, ck.now());
  t3.feed(E('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }, 2), true, ck.now());
  assert.equal(t3.view().text, '输出到上限被截断');
  // planSummary off -> old wording
  const t4 = I.createTracker({ dwellMs: 0, now: ck.now, schedule: ck.schedule, planSummary: false });
  for (const e of FIX.entries) t4.feed(e, true, ck.now());
  assert.match(t4.view().text, /^完成 · 共 3 步 · 3 轮$/);
});

test('2.2.0: todo/write is normalized and no checklist without todo_write', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(I.normTodos([{ content: ' a ', status: 'done' }, { content: '', status: 'pending' }, null, { content: 'b', status: 'in-progress' }, { content: 'c' }]))),
    [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }]);
  assert.equal(I.normTodos('x'), null);
  const tr = I.createTracker({ dwellMs: 0 });
  tr.feed(E('turn/start', { turn: 1 }, 1), true); tr.feed(E('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2), true);
  assert.equal(tr.view().plan, null); assert.equal(tr.view().wrap.total, 0); assert.equal(tr.view().text, '完成 · 共 0 步');
  assert.equal(I.DEFAULT_SETTINGS.planList, true); assert.equal(I.DEFAULT_SETTINGS.costShow, 'threshold'); assert.equal(I.DEFAULT_SETTINGS.costThreshold, 0.05);
});
