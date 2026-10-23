// Keyless OpenAI-compatible mock LLM that plays a realistic multi-step agent loop for driving dsh
// without an API key: streamed reasoning tokens, tool calls whose JSON arguments arrive in several
// partial deltas, a failing tool, an approval-requiring write, a sub-agent, a long-running bash.
import http from 'node:http';
const PORT = +process.env.PORT || 8899;
const THINK_MS = +process.env.THINK_MS || 1400;
const RUN = Date.now().toString(36);
const STEPS = [
  ['todo_write', { todos: [{ content: 'Inspect project', status: 'in_progress' }, { content: 'Write demo', status: 'pending' }] }, 'Plan the work first.'],
  ['read', { file_path: 'README.md' }, 'Read the project README.'],
  ['read', { file_path: 'does-not-exist.txt' }, 'Check an optional config file.'], // fails: missing file
  ['grep', { pattern: 'demo', path: '.' }, 'Search the workspace.'],
  ['web_search', { queries: ['deepseek harness plugin api'] }, 'Look up plugin docs.'],
  ['subagent', { description: 'Summarize README', prompt: 'Summarize README.md in one line.' }, 'Delegate a summary to a sub-agent.'],
  ['bash', { description: 'Run slow test suite', command: 'sleep 5 && echo tests passed' }, 'Run the test suite (slow).'],
  ['write', { file_path: 'src/demo-' + RUN + '.js', content: 'console.log("hello")\n' }, 'Write the demo script.'],
  ['edit', { file_path: 'src/demo-' + RUN + '.js', old_string: 'hello', new_string: 'hello mascot' }, 'Tweak the greeting.'],
  ['bash', { description: 'Install deps with network access', command: 'echo pretend-install', sandbox_permissions: 'danger-full-access', justification: '需要联网安装依赖（演示审批）' }, 'Install deps (needs approval).'],
  ['write', { file_path: 'notes/NOTES-' + RUN + '.md', content: '# Notes\nmascot demo\n' }, 'Write notes.'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((c) => c.text || '').join('') : '');
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  if (!req.url.includes('chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'mock-1', object: 'model' }] })); }
  const j = JSON.parse(body || '{}');
  const msgs = j.messages || [];
  const hasTools = Array.isArray(j.tools) && j.tools.length > 0;
  const users = msgs.map((m, i) => [m, i]).filter(([m]) => m.role === 'user');
  const firstUserText = users.map(([m]) => textOf(m)).join('\n');
  const tour = /tour/i.test(firstUserText); // only the main session runs the scripted loop; sub-agents just answer
  const lastHuman = users.filter(([m]) => /tour/i.test(textOf(m))).pop() || users.pop();
  const since = lastHuman ? msgs.slice(lastHuman[1]) : msgs;
  const n = since.filter((m) => m.role === 'tool').length;
  const avail = new Set((j.tools || []).map((t) => t.function?.name));
  const steps = STEPS.filter(([t]) => avail.has(t));
  console.log(new Date().toISOString(), 'req tools=', hasTools, 'tour=', tour, 'toolMsgs=', n, 'missing=', STEPS.filter(([t]) => !avail.has(t)).map(([t]) => t).join(','));
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const base = { id: 'c' + Date.now(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: j.model || 'mock-1' };
  const send = (delta, finish = null, extra = {}) => res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra }) + '\n\n');
  const usage = { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  if (hasTools && tour && n < steps.length) {
    const [name, args, why] = steps[n];
    // reasoning tokens stream for THINK_MS
    const words = `Okay. ${why} I will call ${name} next.`.split(' ');
    for (const w of words) { send({ role: 'assistant', reasoning_content: w + ' ' }); await sleep(THINK_MS / words.length); }
    send({ content: `Step ${n + 1}: ${why}` }); await sleep(150);
    const id = 'call_' + n + '_' + Date.now(); const a = JSON.stringify(args);
    const parts = [a.slice(0, Math.ceil(a.length / 3)), a.slice(Math.ceil(a.length / 3), Math.ceil(2 * a.length / 3)), a.slice(Math.ceil(2 * a.length / 3))];
    send({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: parts[0] } }] }); await sleep(250);
    send({ tool_calls: [{ index: 0, function: { arguments: parts[1] } }] }); await sleep(250);
    send({ tool_calls: [{ index: 0, function: { arguments: parts[2] } }] });
    send({}, 'tool_calls', usage);
  } else {
    await sleep(600);
    const txt = !hasTools ? 'Mascot demo' : tour ? 'All done. The mascot tour finished.' : 'README: a tiny demo workspace.';
    for (const w of txt.split(' ')) { send({ content: w + ' ' }); await sleep(60); }
    send({}, 'stop', usage);
  }
  res.write('data: [DONE]\n\n'); res.end();
}).listen(PORT, () => console.log('mock llm on', PORT));
