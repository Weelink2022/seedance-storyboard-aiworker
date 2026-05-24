// Phase 7 — 删除回路 + 还原基线
import { launchBrowser, login, snap, logPhase, TESTTEST5, TEST_EP_NUM, RS_HOST } from './_common.mjs';
import fs from 'node:fs';

logPhase(7, '删除回路 + 还原基线');

const { browser, ctx } = await launchBrowser({ headless: true });
const page = await ctx.newPage();

try {
  await login(page);

  // 7.1 拿 ep99 的 ref
  const ep_ref = await page.evaluate(async (host) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=list_episodes&project_ref=16`, { credentials: 'include' });
    const j = await r.json().catch(() => null);
    const list = j?.data?.episodes || [];
    const ep = [...list].reverse().find(e => /E2E测试集/.test(e.title || ''));
    return ep ? ep.ref : null;
  }, RS_HOST);
  console.log('  E2E测试集 ep_ref:', ep_ref);

  if (ep_ref) {
    // 7.2 拿 CSRF + 调 delete_episode API
    const token = await page.evaluate(async (host) => {
      const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=csrf_token`, { credentials: 'include' });
      return r.json();
    }, RS_HOST);
    const csrf_field = token?.data?.field || 'CSRFToken';
    const csrf_value = token?.data?.token || '';

    const del_resp = await page.evaluate(async ({ host, ep, field, tk }) => {
      const fd = new FormData();
      fd.append('ref', String(ep));
      fd.append(field, tk);
      const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=delete_episode`, {
        method: 'POST', body: fd, credentials: 'include',
      });
      return { status: r.status, body: (await r.text()).substring(0, 300) };
    }, { host: RS_HOST, ep: ep_ref, field: csrf_field, tk: csrf_value });
    console.log('  delete_episode resp:', del_resp);
  } else {
    console.log('  E2E测试集 不存在 — 跳过');
  }

  // 7.3 还原 Phase 6 修改的 Pt JSON
  const pt_bak = '/root/tldraw-local-server/uploads/pt-103959.json.bak-phase6';
  if (fs.existsSync(pt_bak)) {
    fs.copyFileSync(pt_bak, '/root/tldraw-local-server/uploads/pt-103959.json');
    fs.unlinkSync(pt_bak);
    console.log('  还原 PT JSON 103959');

    // 重生缩略图 — §51c.fix:用 Puppeteer 真 ViewPane,不调 GD 占位
    const { execSync } = await import('node:child_process');
    execSync(`cd /root/tldraw-local-server && sudo -u www-data node generate-prompt-screenshot-single.js 103959`, { encoding: 'utf8' });
    console.log('  缩略图也还原');
  }

  await snap(page, 'phase_7_done');
  await browser.close();
  console.log('\n[Phase 7] 完成 — 跑 Phase 8 做最终审计');
} catch (e) {
  console.error('[Phase 7 FATAL]', e.message);
  await browser.close();
  process.exit(1);
}
