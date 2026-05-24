// Phase 1 — 漫控台「新建集次」→ 剧集侧验证
// 改进:从 modal HTML 抓 CSRF token,再 POST
import { launchBrowser, login, enterWorkbench, enterSeriesBrowse, snap, logPhase,
         TESTTEST5, TEST_EP_NUM, TEST_EP_TITLE, RS_HOST } from './_common.mjs';

logPhase(1, '漫控台新建集次 → 剧集侧验证');

const { browser, ctx } = await launchBrowser({ headless: true });
const page = await ctx.newPage();

let phase_result = { pass: false, errors: [] };

try {
  await login(page);
  await snap(page, 'phase_1_01_logged_in');

  // 1.1 走漫控台进 testtest5,确认 baseline
  const proto = await enterWorkbench(page, TESTTEST5.project_ref);
  await snap(page, 'phase_1_02_workbench');

  // 1.2 拿 CSRF token — 走 se_create_new.php GET 获取 modal HTML
  const csrf_resp = await page.evaluate(async ({ host, pid }) => {
    const url = `${host}/plugins/ai_series/pages/ajax/se_create_new.php?type=episode&project=${pid}`;
    const r = await fetch(url, { credentials: 'include' });
    const html = await r.text();
    // 抓 hidden input csrf
    // jQuery.post 字符串里的格式: CSRFToken:'xxx@@xxx@@xxx'
    const m = html.match(/(CSRFToken[\w-]*)\s*:\s*['"]([^'"]+)['"]/);
    if (m) return { token_name: m[1], token: m[2], source: 'jquery post string' };
    return { token: null, html_preview: html.substring(0, 500) };
  }, { host: RS_HOST, pid: TESTTEST5.project_ref });
  console.log('  CSRF token 抓取:', csrf_resp.token ? `✅ ${csrf_resp.token_name}` : `❌ ${JSON.stringify(csrf_resp).substring(0,200)}`);

  if (!csrf_resp.token) {
    phase_result.errors.push('CSRF token 抓取失败');
    throw new Error('CSRF token missing');
  }

  // 1.3 POST se_do_create=1 — URL 必须跟 modal 的 jQuery.post URL 完全一致
  // 注:modal 的 form 不传 ep_num,后端按 max(ep_num)+1 算。但我们要 ep_num=99 所以追加查询串
  const create_resp = await page.evaluate(async ({ host, pid, title, token_name, token }) => {
    const fd = new FormData();
    fd.append('se_do_create', '1');
    fd.append('se_new_name', title);
    fd.append(token_name, token);
    const url = `${host}/plugins/ai_series/pages/ajax/se_create_new.php?type=episode&project=${pid}&episode=0&scene=`;
    const r = await fetch(url, { method: 'POST', body: fd, credentials: 'include' });
    return { status: r.status, body: (await r.text()).substring(0, 500) };
  }, { host: RS_HOST, pid: TESTTEST5.project_ref, title: TEST_EP_TITLE,
       token_name: csrf_resp.token_name, token: csrf_resp.token });
  console.log('  创建 episode resp:', create_resp);

  if (create_resp.status !== 200) {
    phase_result.errors.push(`create_resp status=${create_resp.status}`);
  }

  // 1.4 (跨租户验证)用 muyaowu 自己再查一次,看 ep99 是否存在
  await page.waitForTimeout(1500);
  const verify = await page.evaluate(async ({ host, pid }) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=list_episodes&project_ref=${pid}`, { credentials: 'include' });
    const t = await r.text();
    return { status: r.status, snippet: t.substring(0, 600) };
  }, { host: RS_HOST, pid: TESTTEST5.project_ref });
  console.log('  list_episodes 返回:', verify);

  await browser.close();

  // 1.5 后端 DB 直接验证 — 用刚拿到的 create_resp.ref(后端自动编 ep_num)
  const new_ep_ref = JSON.parse(create_resp.body).ref;
  console.log('  → DB 验证 episode ref=' + new_ep_ref);
  const { execSync } = await import('node:child_process');
  const db_check = execSync(`sudo -u www-data php -r "
\\\$_GET=[]; \\\$_POST=[]; \\\$_REQUEST=[]; \\\$_SERVER['REQUEST_METHOD']='GET';
require_once '/var/www/html/resourcespace/10.7/include/boot.php';
\\\$ep_ref = ${new_ep_ref};
\\\$r = ps_query('SELECT ref, ep_num, title FROM ai_series_episode WHERE ref=?', ['i', \\\$ep_ref]);
if (empty(\\\$r)) { echo 'episode 不存在 ❌' . PHP_EOL; exit(1); }
echo '✅ episode ref=' . \\\$r[0]['ref'] . ' ep_num=' . \\\$r[0]['ep_num'] . ' title=' . \\\$r[0]['title'] . PHP_EOL;
\\\$tree = ps_query(\\"SELECT t.ref, t.node_type, t.collection_ref, c.user FROM ai_series_tree t LEFT JOIN collection c ON c.ref=t.collection_ref WHERE t.node_type='episode' AND JSON_EXTRACT(meta_json, '\\\$.v1_episode_ref') = '\\" . \\\$ep_ref . \\"'\\");
if (empty(\\\$tree)) { echo 'episode tree 不存在 ❌' . PHP_EOL; exit(1); }
\\\$ep_tree_ref = (int)\\\$tree[0]['ref'];
\\\$ep_coll_owner = (int)\\\$tree[0]['user'];
echo 'episode tree=' . \\\$ep_tree_ref . ' coll_owner=' . \\\$ep_coll_owner . PHP_EOL;
\\\$kids = ps_query('SELECT t.ref, t.node_type, c.user FROM ai_series_tree t LEFT JOIN collection c ON c.ref=t.collection_ref WHERE t.parent_ref=?', ['i', \\\$ep_tree_ref]);
echo '子 tree (' . count(\\\$kids) . '):' . PHP_EOL;
\\\$admin=0; \\\$user6=0;
foreach (\\\$kids as \\\$k) { echo '  ' . \\\$k['node_type'] . ' owner=' . \\\$k['user'] . PHP_EOL; if ((int)\\\$k['user']===1) \\\$admin++; elseif ((int)\\\$k['user']===6) \\\$user6++; }
if (\\\$ep_coll_owner===1) \\\$admin++; elseif (\\\$ep_coll_owner===6) \\\$user6++;
echo PHP_EOL . '§51 验证: admin=' . \\\$admin . ' user6=' . \\\$user6 . PHP_EOL;
echo (\\\$admin===0 ? '✅ owner 全部=muyaowu' : '❌ 有 admin 残留') . PHP_EOL;
" 2>&1`, { encoding: 'utf8' });
  console.log(db_check);

  if (db_check.includes('admin=0') && db_check.includes('✅ episode ref=')) {
    phase_result.pass = true;
  } else {
    phase_result.errors.push('DB 验证未通过');
  }

  console.log(phase_result.pass ? '\n[Phase 1] ✅ PASS' : `\n[Phase 1] ❌ FAIL: ${phase_result.errors.join(', ')}`);
  process.exit(phase_result.pass ? 0 : 1);
} catch (e) {
  console.error('[Phase 1 FATAL]', e.message);
  await snap(page, 'phase_1_FATAL').catch(() => null);
  await browser.close().catch(() => null);
  process.exit(1);
}
