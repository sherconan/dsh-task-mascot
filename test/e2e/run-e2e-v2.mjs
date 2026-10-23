// v2 E2E against the real dsh web (port 7777) + realistic mock LLM. Records every mascot state change on
// all three surfaces (inline card / dock bar / floating pet) via a MutationObserver, screenshots each
// new state, verifies approval + error states appear in the real page, and dumps latency numbers.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const Q = process.env.QDIR || new URL('../../qa/v2', import.meta.url).pathname; mkdirSync(Q + '/video', { recursive: true });
const url = readFileSync(Q + '/dsh-web.log', 'utf8').match(/http:\S+token=\S+/)[0];
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, recordVideo: { dir: Q + '/video', size: { width: 1360, height: 900 } } });
await ctx.addInitScript(() => {
  localStorage.setItem('dsh-task-mascot:settings:v2', JSON.stringify({ inline: true, dock: true, pet: true, size: 130, corner: 'top-right', dwellMs: 600 }));
  window.__mascotTL = [];
  const seen = new WeakMap();
  const scan = () => {
    for (const el of document.querySelectorAll('[data-mascot-card], #dsh-task-mascot')) {
      const surf = el.id === 'dsh-task-mascot' ? 'pet' : el.getAttribute('data-mascot-card');
      const key = el.getAttribute('data-state') + '|' + (el.querySelector('[data-mascot-action]')?.textContent || el.title || '');
      if (seen.get(el) !== key) { seen.set(el, key); window.__mascotTL.push({ t: Date.now(), surf, state: el.getAttribute('data-state'), resolved: el.getAttribute('data-resolved'), step: el.getAttribute('data-step'), text: (el.querySelector('[data-mascot-action]')?.textContent || '').slice(0, 80) }); }
    }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['data-state', 'title'] });
});
const p = await ctx.newPage();
await p.goto(url); await p.waitForTimeout(5000);
await p.getByText('New Session').first().click().catch(() => {}); await p.waitForTimeout(1000);
if (await p.getByText('Choose workspace').count()) { await p.getByText('Choose workspace').click(); await p.waitForTimeout(800); await p.getByText('mascot-demo-ws', { exact: true }).click(); await p.waitForTimeout(600); await p.getByRole('button', { name: 'Open' }).click(); await p.waitForTimeout(1500); }
await p.screenshot({ path: Q + '/00-before.png' });
for (let i = 0; i < 3 && await p.locator('[role=dialog][aria-label="Get started"]').count(); i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
await p.locator('[data-composer-input="true"]').click(); await p.keyboard.type(process.env.PROMPT || 'Please tour the tools'); await p.keyboard.press('Enter');
const shots = new Set(); let approvals = []; let n = 0; const t0 = Date.now(); let doneAt = 0;
while (Date.now() - t0 < +(process.env.MAXMS || 150000)) {
  await p.waitForTimeout(150);
  const st = await p.locator('[data-mascot-card="inline"]').getAttribute('data-state', { timeout: 200 }).catch(() => null);
  if (st && !shots.has(st)) { shots.add(st); await p.screenshot({ path: `${Q}/state-${String(++n).padStart(2, '0')}-${st}.png` }); }
  const btns = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => x.innerText.trim()).filter((x) => x && x.length < 40));
  const appr = btns.filter((x) => /^(allow|approve|allow once|deny|reject|允许|拒绝|批准)/i.test(x));
  if (appr.length && !approvals.some((a) => Date.now() - a.at < 4000)) {
    await p.waitForTimeout(1200); // let the waiting state be visible
    await p.screenshot({ path: `${Q}/approval-prompt.png` });
    const pick = appr.find((x) => /allow|approve|允许|批准/i.test(x)) || appr[0];
    approvals.push({ at: Date.now(), buttons: appr, clicked: pick, cardState: await p.locator('[data-mascot-card="inline"]').getAttribute('data-state').catch(() => null), dockState: await p.locator('[data-mascot-card="dock"]').getAttribute('data-state').catch(() => null), petState: await p.locator('#dsh-task-mascot').getAttribute('data-state').catch(() => null) });
    await p.getByRole('button', { name: pick, exact: true }).first().click().catch((e) => console.log('click fail', e.message));
    console.log('approval', approvals.at(-1));
  }
  if (st === 'done' && !doneAt) { doneAt = Date.now(); await p.waitForTimeout(300); await p.screenshot({ path: Q + '/state-done-inline.png' }); }
  if (doneAt && Date.now() - doneAt > 7000) break;
}
await p.screenshot({ path: Q + '/99-final-turn-summary.png' });
const tl = await p.evaluate(() => window.__mascotTL);
const lat = await p.evaluate(() => window.__dshMascotLatency || []);
// settings panel
await p.keyboard.press('Control+,').catch(() => {}); await p.waitForTimeout(800);
writeFileSync(Q + '/timeline.json', JSON.stringify({ approvals, timeline: tl.map((x) => ({ ...x, t: ((x.t - t0) / 1000).toFixed(2) })) }, null, 2));
writeFileSync(Q + '/latency.json', JSON.stringify(lat, null, 2));
const stat = (arr) => { const a = arr.filter((x) => typeof x === 'number').sort((x, y) => x - y); if (!a.length) return null; const q = (f) => a[Math.min(a.length - 1, Math.floor(f * a.length))]; return { n: a.length, min: a[0], p50: q(0.5), p95: q(0.95), max: a.at(-1), mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) }; };
const summary = {};
for (const surf of ['inline', 'dock', 'pet']) {
  const L = lat.filter((x) => x.surface === surf);
  const direct = L.filter((x) => x.queueWait <= 5);
  summary[surf] = { frames: L.length, recvToPaint_unqueued: stat(direct.map((x) => x.recvToPaint)), eventToPaint_unqueued: stat(direct.map((x) => x.eventToPaint)), queueWait_all: stat(L.map((x) => x.queueWait)), eventToRecv: stat(L.map((x) => x.eventToRecv)) };
}
const states = [...new Set(tl.filter((x) => x.surf === 'inline').map((x) => x.state))];
summary.statesSeenInline = states; summary.approvalTriggered = approvals.length > 0 && approvals.some((a) => a.cardState === 'waiting'); summary.errorShown = states.includes('error'); summary.approvals = approvals;
writeFileSync(Q + '/latency-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await ctx.close(); await b.close();
