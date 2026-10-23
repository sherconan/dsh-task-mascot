// Release smoke test: pet + inline/dock cards render, grep escapes display, pet chip stays on screen.
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
const Q = process.env.QDIR || new URL('../../qa/release', import.meta.url).pathname; mkdirSync(Q, { recursive: true });
const url = readFileSync(Q + '/dsh-web.log', 'utf8').match(/http:\S+token=\S+/)[0];
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('dsh-task-mascot:settings:v2', JSON.stringify({ inline: true, dock: true, pet: true, size: 130, corner: 'bottom-right', dwellMs: 600 })));
const p = await ctx.newPage();
await p.goto(url); await p.waitForTimeout(5000);
await p.getByText('New Session').first().click().catch(() => {}); await p.waitForTimeout(1000);
if (await p.getByText('Choose workspace').count()) { await p.getByText('Choose workspace').click(); await p.waitForTimeout(800); await p.getByText(process.env.WS || 'mascot-demo-ws', { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(600); await p.getByRole('button', { name: 'Open' }).click().catch(() => {}); await p.waitForTimeout(1500); }
await p.locator('[data-composer-input="true"]').click(); await p.keyboard.type('Please tour the tools'); await p.keyboard.press('Enter');
const r = { inline: false, dock: false, pet: false, grepTexts: new Set(), chipOverflow: [], chipSamples: 0, states: new Set() };
const t0 = Date.now(); let doneAt = 0, shot = 0;
while (Date.now() - t0 < 150000) {
  await p.waitForTimeout(150);
  const s = await p.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const chip = q('#dsh-task-mascot [data-mascot-chip]'); const cr = chip && chip.getBoundingClientRect();
    return { inline: q('[data-mascot-card="inline"]')?.getAttribute('data-state'), dock: !!q('[data-mascot-card="dock"]'), pet: !!q('#dsh-task-mascot video, #dsh-task-mascot img'),
      actions: [...document.querySelectorAll('[data-mascot-action]')].map((e) => e.textContent), chip: chip && { text: chip.textContent, l: cr.left, r: cr.right, vw: innerWidth },
      btns: [...document.querySelectorAll('button')].map((x) => x.innerText.trim()).filter((x) => /^(allow once|allow|approve)/i.test(x)) };
  });
  if (s.inline) { r.inline = true; r.states.add(s.inline); } if (s.dock) r.dock = true; if (s.pet) r.pet = true;
  for (const a of s.actions) if (/搜索/.test(a)) r.grepTexts.add(a);
  if (s.chip) { r.chipSamples++; if (s.chip.r > s.chip.vw || s.chip.l < 0) r.chipOverflow.push(s.chip); if (/运行/.test(s.chip.text) && !shot++) await p.screenshot({ path: Q + '/pet-bash.png' }); }
  if (s.btns.length) { await p.getByRole('button', { name: s.btns[0], exact: true }).first().click().catch(() => {}); await p.waitForTimeout(500); }
  if (s.inline === 'done' && !doneAt) doneAt = Date.now();
  if (doneAt && Date.now() - doneAt > 3000) break;
}
await p.screenshot({ path: Q + '/final.png' });
const out = { ...r, grepTexts: [...r.grepTexts], states: [...r.states] };
out.grepEscapeOk = out.grepTexts.some((t) => t.includes('foo\\.bar"q')) && !out.grepTexts.some((t) => t.includes('\\\\'));
out.ok = out.inline && out.dock && out.pet && out.grepEscapeOk && !out.chipOverflow.length && out.states.includes('done');
console.log(JSON.stringify(out, null, 2)); await b.close(); process.exit(out.ok ? 0 : 1);
