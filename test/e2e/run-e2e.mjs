// Headless E2E: real dsh web + mock LLM. Drives one session through the scripted tool tour
// and records the mascot state timeline, screenshots and a video into qa/.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const QA = (process.env.QDIR || new URL('../../qa', import.meta.url).pathname); mkdirSync(QA + '/video', { recursive: true });
const url = readFileSync(QA + '/dsh-web.log', 'utf8').match(/http:\S+token=\S+/)[0];
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: QA + '/video', size: { width: 1280, height: 800 } } });
const p = await ctx.newPage();
await p.goto(url); await p.waitForTimeout(5000);
await p.getByRole('button', { name: 'Continue' }).click().catch(() => {});
await p.getByText('New Session').first().click().catch(() => {}); await p.waitForTimeout(1000);
if (await p.getByText('Choose workspace').count()) {
  await p.getByText('Choose workspace').click(); await p.waitForTimeout(800);
  await p.getByText('mascot-demo-ws', { exact: true }).click(); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'Open' }).click(); await p.waitForTimeout(1500);
}
await p.screenshot({ path: QA + '/01-idle.png' });
const box = p.locator('[data-composer-input="true"]');
await box.click(); await p.keyboard.type('Please tour the tools'); await p.keyboard.press('Enter');
const timeline = []; const shots = new Set(); let approvals = 0;
const t0 = Date.now();
for (let i = 0; i < 240; i++) {
  await p.waitForTimeout(250);
  const m = p.locator('#dsh-task-mascot');
  const st = await m.getAttribute('data-state').catch(() => null);
  const rs = await m.getAttribute('data-resolved').catch(() => null);
  const chip = await p.locator('[data-mascot-chip]').textContent().catch(() => null);
  const vis = await p.evaluate(() => [...document.querySelectorAll('#dsh-task-mascot video')].map((v) => `${v.dataset.buf}:${v.style.opacity}:${v.readyState}:${(v.currentSrc || '').split('%2F').pop()}`).join(' '));
  if (!timeline.length || timeline.at(-1).state !== st) {
    timeline.push({ t: ((Date.now() - t0) / 1000).toFixed(1), state: st, resolved: rs, chip, vis });
    console.log(timeline.at(-1));
    if (st && !shots.has(st)) { shots.add(st); await p.waitForTimeout(400); await p.screenshot({ path: `${QA}/state-${String(shots.size).padStart(2, '0')}-${st}.png` }); }
  }
  // Approve any tool permission prompt (Standard mode) so the tour continues.
  for (const name of ['Allow', 'Approve', 'Allow once', 'Yes', '允许']) {
    const btn = p.getByRole('button', { name, exact: true });
    if (await btn.count().catch(() => 0)) { await btn.first().click().catch(() => {}); approvals++; break; }
  }
  if (st === 'idle' && timeline.some((x) => x.state === 'done') && i > 20) break;
}
await p.screenshot({ path: QA + '/99-final.png' });
// Settings panel screenshot
writeFileSync(QA + '/timeline.json', JSON.stringify({ approvals, timeline }, null, 2));
await ctx.close(); await b.close();
console.log('approvals clicked:', approvals);
