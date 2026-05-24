// Phase 4 — 重置数据(仅当集 ep01)+ §51 helper 级联删验证
// 直接调 one_click_film_reset API
import { launchBrowser, login, snap, logPhase, TESTTEST5, RS_HOST } from './_common.mjs';

logPhase(4, '重置数据 ep01 + 级联删验证');

const { browser, ctx } = await launchBrowser({ headless: true });
const page = await ctx.newPage();
let phase_result = { pass: false, errors: [] };

try {
  await login(page);

  // 4.1 拿 CSRF token
  const token_resp = await page.evaluate(async (host) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=csrf_token`, { credentials: 'include' });
    return r.json();
  }, RS_HOST);
  const csrf_field = token_resp?.data?.field || 'CSRFToken';
  const csrf_value = token_resp?.data?.token || '';
  console.log('  CSRF:', csrf_value ? '✅' : '❌');

  // 4.2 调 reset API
  const payload = {
    project_ref: TESTTEST5.project_ref,
    episode_index: 1,
    scope: 'episode',
    clean_script: false,
  };
  const reset_resp = await page.evaluate(async ({ host, body, field, token }) => {
    const url = `${host}/plugins/ai_series/pages/api.php?action=one_click_film_reset&${encodeURIComponent(field)}=${encodeURIComponent(token)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return { status: r.status, body: (await r.text()).substring(0, 1500) };
  }, { host: RS_HOST, body: payload, field: csrf_field, token: csrf_value });
  console.log('  reset resp:', reset_resp);

  if (reset_resp.status !== 200) {
    phase_result.errors.push(`reset status=${reset_resp.status}`);
    throw new Error('reset failed');
  }

  await snap(page, 'phase_4_after_reset');
  await browser.close();

  // 4.3 DB 双边审计
  console.log('\n  → DB 审计');
  const { execSync } = await import('node:child_process');
  const db_check = execSync(`sudo -u www-data php -r "
\\\$_GET=[]; \\\$_POST=[]; \\\$_REQUEST=[]; \\\$_SERVER['REQUEST_METHOD']='GET';
require_once '/var/www/html/resourcespace/10.7/include/boot.php';

echo '─ testtest5 各类型 active 资源数(reset 后) ─' . PHP_EOL;
foreach ([1=>'Photo',15=>'Shot',16=>'Script',17=>'Char',18=>'Scene',19=>'Voice',21=>'Prop'] as \\\$t => \\\$n) {
    \\\$c = ps_query('SELECT COUNT(*) AS c FROM ai_series_project_asset pa JOIN resource r ON r.ref=pa.resource_ref WHERE pa.project_ref=16 AND r.resource_type=? AND r.archive=0', ['i', \\\$t]);
    echo '  ' . \\\$n . ': ' . \\\$c[0]['c'] . PHP_EOL;
}

echo PHP_EOL . '─ §51 全系统健康 ─' . PHP_EOL;
\\\$r = ps_query(\\"SELECT COUNT(*) AS n FROM collection WHERE type=4 AND user=1 AND ref NOT IN (SELECT collection_ref FROM ai_series_tree WHERE collection_ref>0)\\");
echo '  跨租户孤儿: ' . \\\$r[0]['n'] . PHP_EOL;
\\\$r = ps_query(\\"SELECT COUNT(*) AS n FROM collection_resource cr JOIN resource r ON r.ref=cr.resource WHERE r.archive=3\\");
echo '  archive=3 漏网挂载: ' . \\\$r[0]['n'] . PHP_EOL;
\\\$r = ps_query(\\"SELECT COUNT(*) AS n FROM ai_series_tree t WHERE t.collection_ref>0 AND NOT EXISTS (SELECT 1 FROM collection c WHERE c.ref=t.collection_ref)\\");
echo '  tree 死引用: ' . \\\$r[0]['n'] . PHP_EOL;
\\\$r = ps_query(\\"SELECT COUNT(*) AS n FROM ai_series_project_asset pa WHERE NOT EXISTS (SELECT 1 FROM resource r WHERE r.ref=pa.resource_ref)\\");
echo '  project_asset 死引用: ' . \\\$r[0]['n'] . PHP_EOL;

echo PHP_EOL . '─ testtest5 ep01 tree 节点(应该清空 scene/shot) ─' . PHP_EOL;
\\\$ep1 = ps_query(\\"SELECT ref FROM ai_series_tree WHERE node_type='episode' AND parent_ref IN (SELECT ref FROM ai_series_tree WHERE node_type='project' AND JSON_EXTRACT(meta_json, '\\\$.v1_project_ref') = '16') AND JSON_EXTRACT(meta_json, '\\\$.v1_episode_ref') = '15'\\");
if (!empty(\\\$ep1)) {
    \\\$ep_ref = (int)\\\$ep1[0]['ref'];
    foreach (['scene','shot','boards'] as \\\$nt) {
        \\\$c = ps_query('SELECT COUNT(*) AS c FROM ai_series_tree WHERE node_type=? AND (parent_ref=? OR parent_ref IN (SELECT ref FROM ai_series_tree WHERE parent_ref=?))', ['s', \\\$nt, 'i', \\\$ep_ref, 'i', \\\$ep_ref]);
        echo '  ' . \\\$nt . ' tree: ' . \\\$c[0]['c'] . PHP_EOL;
    }
}

echo PHP_EOL . '─ Pt 卡(应该未动) ─' . PHP_EOL;
\\\$pt = ps_query(\\"SELECT r.ref, r.field8 FROM collection_resource cr JOIN resource r ON r.ref=cr.resource WHERE cr.collection=10784 AND r.resource_type=2 AND r.archive=0\\");
echo '  testtest5 提示词库 Pt 卡数: ' . count(\\\$pt) . PHP_EOL;
foreach (\\\$pt as \\\$p) echo '    ref=' . \\\$p['ref'] . ' ' . \\\$p['field8'] . PHP_EOL;

echo PHP_EOL . '─ 工作目录 outputs ─' . PHP_EOL;
\\\$workdir = '/var/lib/ai_series_ocf/16/ep01';
foreach (['outputs','assets','.seedance-runtime','merge_manifests'] as \\\$d) {
    \\\$p = \\\$workdir . '/' . \\\$d;
    echo '  ' . \\\$d . ': ' . (is_dir(\\\$p) ? '⚠️ 仍存在' : '✅ 已清') . PHP_EOL;
}
" 2>&1`, { encoding: 'utf8' });
  console.log(db_check);

  // PASS 判定:全系统健康 4/4 + ep01 scene/shot tree=0
  const health_pass = db_check.includes('跨租户孤儿: 0')
    && db_check.includes('archive=3 漏网挂载: 0')
    && db_check.includes('tree 死引用: 0')
    && db_check.includes('project_asset 死引用: 0');
  const tree_pass = /scene tree: 0/.test(db_check) && /shot tree: 0/.test(db_check);

  if (health_pass && tree_pass) {
    phase_result.pass = true;
  } else {
    if (!health_pass) phase_result.errors.push('全系统健康未通过');
    if (!tree_pass) phase_result.errors.push('ep01 tree 未清空');
  }

  console.log(phase_result.pass ? '\n[Phase 4] ✅ PASS' : `\n[Phase 4] ❌ FAIL: ${phase_result.errors.join(', ')}`);
  process.exit(phase_result.pass ? 0 : 1);
} catch (e) {
  console.error('[Phase 4 FATAL]', e.message);
  await browser.close().catch(() => null);
  process.exit(1);
}
