// Phase 6 — 缩略图主动再生(改 Pt JSON → 重生 → 验证新内容)
import { launchBrowser, login, snap, logPhase, RS_HOST } from './_common.mjs';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

logPhase(6, '缩略图主动再生');

const PT_REF = 103959; // testtest5 人物提示词库
const PT_JSON = `/root/tldraw-local-server/uploads/pt-${PT_REF}.json`;

// 6.1 备份原 JSON
const backup_path = PT_JSON + '.bak-phase6';
if (!fs.existsSync(backup_path)) {
  fs.copyFileSync(PT_JSON, backup_path);
  console.log('  备份原 JSON:', backup_path);
}

// 6.2 加一条 item
const items = JSON.parse(fs.readFileSync(PT_JSON, 'utf8'));
const new_item = {
  id: Date.now(),
  title: 'E2E测试条目-' + new Date().toISOString().slice(11, 19),
  positivePrompt: '测试 positive',
  negativePrompt: '',
  pinned: false,
};
items.push(new_item);
fs.writeFileSync(PT_JSON, JSON.stringify(items, null, 2));
console.log('  写入新 item:', new_item.title);

// 6.3 跑缩略图生成 — §51c.fix(2026-05-24):改用 Puppeteer 真 ViewPane 截图,
//     不要再调老 GD 占位 generate-pt-thumbnail.php(那会把缩略图降级成"Pt"白底字)
try {
  const out = execSync(`cd /root/tldraw-local-server && sudo -u www-data node generate-prompt-screenshot-single.js ${PT_REF}`, { encoding: 'utf8' });
  console.log('  generate-prompt-screenshot-single.js 输出:', out);
} catch (e) {
  console.error('  ❌ 缩略图生成失败:', e.message);
  // 还原
  fs.copyFileSync(backup_path, PT_JSON);
  process.exit(1);
}

// 6.4 Playwright 拿缩略图,确认含新 item
const { browser, ctx } = await launchBrowser({ headless: true });
const page = await ctx.newPage();

try {
  await login(page);
  const ts = Date.now();
  const url = `${RS_HOST}/pages/download.php?ref=${PT_REF}&size=thm&noattach=true&v=${ts}`;
  const buf = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    const b = await r.arrayBuffer();
    return [r.status, b.byteLength];
  }, url);
  console.log(`  HTTP GET thm: status=${buf[0]} size=${buf[1]} bytes`);

  // 直接下载到文件人眼看
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await snap(page, 'phase_6_new_thumbnail');

  await browser.close();
  console.log('\n[Phase 6] 完成 — 截图见 phase_6_new_thumbnail.png');
  console.log('  ⚠️ 测试后 Phase 7 会还原 PT_JSON,或手动:');
  console.log(`     cp "${backup_path}" "${PT_JSON}"`);
} catch (e) {
  console.error('[Phase 6 FATAL]', e.message);
  fs.copyFileSync(backup_path, PT_JSON);
  await browser.close();
  process.exit(1);
}
