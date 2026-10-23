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
  const cases = { bash: 'cmd', pwsh: 'cmd', terminal_send: 'cmd', read: 'reading', grep: 'search', glob: 'search', web_search: 'search', web_fetch: 'search', write: 'coding', edit: 'editing', str_replace_editor: 'editing', todo_write: 'planning', update_goal: 'planning', subagent: 'subagents', spawn_teammate: 'subagents', ask_user_question: 'waiting', run_code: 'data', present: 'summary', some_mcp_tool: 'tools' };
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
