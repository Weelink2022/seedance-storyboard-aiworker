// Phase 2 — 剧集侧「新建场次」→ 漫控台验证
// 走 se_create_new.php?type=scene + CSRF token
import { launchBrowser, login, enterWorkbench, snap, logPhase,
         TESTTEST5, TEST_SCENE_NAME, RS_HOST } from './_common.mjs';

logPhase(2, '剧集侧新建场次 → 漫控台验证');

const { browser, ctx } = await launchBrowser({ headless: true });
const page = await ctx.newPage();
let phase_result = { pass: false, errors: [] };

try {
  await login(page);

  // 2.1 找最新建的 E2E测试集 episode_ref
  const ep_ref = await page.evaluate(async (host) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=list_episodes&project_ref=16`, { credentials: 'include' });
    const j = await r.json().catch(() => null);
    const list = j?.data?.episodes || j?.data || [];
    if (Array.isArray(list)) {
      const ep = [...list].reverse().find(e => /E2E测试集/.test(e.title || ''));
      return ep ? ep.ref : null;
    }
    return null;
  }, RS_HOST);
  console.log('  目标 ep_ref:', ep_ref);
  if (!ep_ref) {
    phase_result.errors.push('找不到 E2E测试集 episode');
    throw new Error('no E2E ep');
  }

  // 2.2 拿 scene 创建 modal HTML + CSRF token
  const csrf = await page.evaluate(async ({ host, ep }) => {
    const url = `${host}/plugins/ai_series/pages/ajax/se_create_new.php?type=scene&episode=${ep}`;
    const r = await fetch(url, { credentials: 'include' });
    const html = await r.text();
    const m = html.match(/(CSRFToken[\w-]*)\s*:\s*['"]([^'"]+)['"]/);
    if (m) return { token_name: m[1], token: m[2], html_action_url_snippet: html.match(/jQuery\.post\(['"]([^'"]+)['"]/)?.[1] || '' };
    return { token: null, preview: html.substring(0, 400) };
  }, { host: RS_HOST, ep: ep_ref });
  console.log('  CSRF:', csrf.token ? `✅ name=${csrf.token_name}` : `❌ ${JSON.stringify(csrf).substring(0,200)}`);
  console.log('  modal post url:', csrf.html_action_url_snippet);
  if (!csrf.token) {
    phase_result.errors.push('CSRF token 拿不到');
    throw new Error('csrf');
  }

  // 2.3 POST se_do_create=1
  const create_resp = await page.evaluate(async ({ host, ep, name, token_name, token }) => {
    const fd = new FormData();
    fd.append('se_do_create', '1');
    fd.append('se_new_name', name);
    fd.append(token_name, token);
    const url = `${host}/plugins/ai_series/pages/ajax/se_create_new.php?type=scene&project=0&episode=${ep}&scene=`;
    const r = await fetch(url, { method: 'POST', body: fd, credentials: 'include' });
    return { status: r.status, body: (await r.text()).substring(0, 500) };
  }, { host: RS_HOST, ep: ep_ref, name: TEST_SCENE_NAME, token_name: csrf.token_name, token: csrf.token });
  console.log('  创建 scene resp:', create_resp);

  await page.waitForTimeout(1500);
  await browser.close();

  // 2.4 DB 验证 — scene tree + owner
  console.log('\n  → DB 验证');
  const { execSync } = await import('node:child_process');
  const db_check = execSync(`sudo -u www-data php -r "
\\\$_GET=[]; \\\$_POST=[]; \\\$_REQUEST=[]; \\\$_SERVER['REQUEST_METHOD']='GET';
require_once '/var/www/html/resourcespace/10.7/include/boot.php';
\\\$ep_ref = ${ep_ref};
\\\$ep_tree = ps_query(\\"SELECT ref FROM ai_series_tree WHERE node_type='episode' AND JSON_EXTRACT(meta_json, '\\\$.v1_episode_ref') = '\\" . \\\$ep_ref . \\"'\\");
if (empty(\\\$ep_tree)) { echo 'episode tree 不存在 ❌' . PHP_EOL; exit(1); }
\\\$ep_tree_ref = (int)\\\$ep_tree[0]['ref'];
\\\$scenes = ps_query(\\"SELECT t.ref, c.user, c.name FROM ai_series_tree t LEFT JOIN collection c ON c.ref=t.collection_ref WHERE t.parent_ref=? AND t.node_type='scene'\\", ['i', \\\$ep_tree_ref]);
if (empty(\\\$scenes)) { echo 'scene tree 不存在 ❌' . PHP_EOL; exit(1); }
echo 'scene tree 数: ' . count(\\\$scenes) . PHP_EOL;
\\\$admin = 0; \\\$user6 = 0; \\\$found_target = false;
foreach (\\\$scenes as \\\$s) {
    echo '  scene tree=' . \\\$s['ref'] . ' owner=' . \\\$s['user'] . ' name=' . \\\$s['name'] . PHP_EOL;
    if (strpos((string)\\\$s['name'], 'E2E测试场1') !== false) \\\$found_target = true;
    if ((int)\\\$s['user']===1) \\\$admin++; elseif ((int)\\\$s['user']===6) \\\$user6++;
}
echo (\\\$found_target ? '✅ 找到 E2E测试场1' : '❌ 没找到 E2E测试场1') . PHP_EOL;
echo '§51 owner 验证: admin=' . \\\$admin . ' user6=' . \\\$user6 . PHP_EOL;
" 2>&1`, { encoding: 'utf8' });
  console.log(db_check);

  if (db_check.includes('找到 E2E测试场1') && db_check.includes('admin=0')) {
    phase_result.pass = true;
  } else {
    phase_result.errors.push('DB 验证未通过');
  }
  console.log(phase_result.pass ? '\n[Phase 2] ✅ PASS' : `\n[Phase 2] ❌ FAIL: ${phase_result.errors.join(', ')}`);
  process.exit(phase_result.pass ? 0 : 1);
} catch (e) {
  console.error('[Phase 2 FATAL]', e.message);
  await browser.close().catch(() => null);
  process.exit(1);
}
