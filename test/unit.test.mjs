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
  const cases = { bash: 'cmd', pwsh: 'cmd', terminal_send: 'cmd', read: 'reading', grep: 'search', glob: 'search', web_search: 'web', web_fetch: 'web', read_image: 'media', mcp__github__x: 'mcp', session_search: 'memory', create_worktree: 'git', write: 'coding', edit: 'editing', str_replace_editor: 'editing', todo_write: 'planning', update_goal: 'planning', subagent: 'subagents', spawn_teammate: 'subagents', ask_user_question: 'waiting', run_code: 'data', present: 'summary', some_mcp_tool: 'tools' };
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
  const tools = ['bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'str_replace_editor', 'glob', 'grep', 'web_fetch', 'web_search', 'subagent', 'spawn_teammate', 'wait_agent', 'send_message', 'team_task_create', 'todo_write', 'create_goal', 'update_goal', 'ralph', 'schedule_create', 'job_output', 'terminal_send', 'session_search', 'list_mcp_resources', 'read_mcp_resource', 'mcp__x__y', 'skill', 'plugin_manager', 'plugin_market', 'working_directory', 'create_worktree', 'load_workspace_dependencies', 'present', 'ask_user_question', 'exit_plan_mode', 'lsp', 'stagehand_act', 'cordis_inspect_tree', 'run_code'];
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
