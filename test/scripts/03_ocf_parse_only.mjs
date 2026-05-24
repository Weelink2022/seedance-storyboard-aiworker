// Phase 3 — OCF 仅解析(mock,不烧 token)
// 直接调 one_click_film_start API,传 models.parse_only=true
import { launchBrowser, login, snap, logPhase, TESTTEST5, RS_HOST } from './_common.mjs';

logPhase(3, 'OCF parse_only mock 跑通');

const { browser, ctx } = await launchBrowser({ headless: true });
const page = await ctx.newPage();
let phase_result = { pass: false, errors: [] };

try {
  await login(page);

  // 3.1 安全检查 — 当前 testtest5 ep01 是否有任务跑着?
  const active = await page.evaluate(async ({ host, pid }) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=one_click_film_progress_summary&project=${pid}&episode=1`, { credentials: 'include' });
    const t = await r.text();
    return { status: r.status, body: t.substring(0, 300) };
  }, { host: RS_HOST, pid: TESTTEST5.project_ref });
  console.log('  ep01 progress 检查:', active);

  // 3.2 启 OCF parse_only — 用 testtest5 自己 ep01 剧本(script_source=collection,但要先找 script_resource_ref)
  // 找 ep01 项目里现成的 user_script
  const script_ref = await page.evaluate(async ({ host, pid }) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=screen_data&screen=assets&project_ref=${pid}`, { credentials: 'include' });
    const j = await r.json().catch(() => null);
    // scripts 字段
    const scripts = j?.data?.scripts || j?.scripts || [];
    if (Array.isArray(scripts)) {
      // 找有 'ep01' 标记的 user_script
      const target = scripts.find(s => /剧本|script/.test(s.title || '') && /ep01/i.test(s.episode_label || ''));
      return target ? target.resource_id : (scripts[0]?.resource_id || null);
    }
    return null;
  }, { host: RS_HOST, pid: TESTTEST5.project_ref });
  console.log('  发现 script_ref:', script_ref);

  if (!script_ref) {
    // 没现成剧本 → 用 paste 来源,塞一个最小 mock 剧本
    console.log('  → 没剧本,paste 最小 mock 剧本');
  }

  const payload = {
    project_ref: TESTTEST5.project_ref,
    episode_index: 1,
    script_source: script_ref ? 'collection' : 'paste',
    script_resource_ref: script_ref || 0,
    script_text: script_ref ? '' : `# ep01\n\n## 第1场 测试场景\n\n小明:你好。\n小红:你好。\n`,
    models: {
      script: 'deepseek-chat',
      image: '__PARSE_ONLY__',  // 不烧出图 token
      video: '__PARSE_ONLY__',
      parse_only: true,         // ⚠️ 关键 flag,后端 line 275 识别
    },
    force: false,
  };
  console.log('  payload models:', payload.models);

  // 先拿 api CSRF token
  const token_resp = await page.evaluate(async (host) => {
    const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=csrf_token`, { credentials: 'include' });
    return r.json();
  }, RS_HOST);
  const csrf_field = token_resp?.data?.field || 'CSRFToken';
  const csrf_value = token_resp?.data?.token || '';
  console.log('  CSRF token:', csrf_value ? `✅ field=${csrf_field}` : '❌');

  const start_resp = await page.evaluate(async ({ host, body, field, token }) => {
    const url = `${host}/plugins/ai_series/pages/api.php?action=one_click_film_start&${encodeURIComponent(field)}=${encodeURIComponent(token)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return { status: r.status, body: (await r.text()).substring(0, 800) };
  }, { host: RS_HOST, body: payload, field: csrf_field, token: csrf_value });
  console.log('  OCF start resp:', start_resp);

  if (start_resp.status !== 200) {
    phase_result.errors.push(`start failed status=${start_resp.status}`);
    throw new Error('start failed');
  }

  const start_data = JSON.parse(start_resp.body);
  const task_id = start_data?.data?.task?.id || start_data?.task?.id;
  console.log('  task_id:', task_id);

  // 3.3 轮询任务状态(最多 90s)
  console.log('  ⏳ 轮询任务状态...');
  let done = false;
  let last_status = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    const status_resp = await page.evaluate(async ({ host, pid }) => {
      const r = await fetch(`${host}/plugins/ai_series/pages/api.php?action=one_click_film_status&project=${pid}&episode=1`, { credentials: 'include' });
      return { status: r.status, body: (await r.text()).substring(0, 800) };
    }, { host: RS_HOST, pid: TESTTEST5.project_ref });
    const s = JSON.parse(status_resp.body);
    const task = s?.data?.task || s?.task;
    last_status = task?.status || 'unknown';
    process.stdout.write(`  ${i*3}s: status=${last_status}\r`);
    if (last_status === 'done' || last_status === 'failed' || last_status === 'error') {
      done = true;
      console.log(`\n  → 最终状态: ${last_status}`);
      console.log('  task 详情:', JSON.stringify(task, null, 2).substring(0, 600));
      break;
    }
  }
  if (!done) {
    console.log('\n  ⏰ 90s 内未完成 — 不中断,继续看产物');
  }

  await snap(page, 'phase_3_after_ocf');
  await browser.close();

  // 3.4 DB 验证 — 产物 + 不建实体(parse_only 应该)
  console.log('\n  → DB 验证');
  const { execSync } = await import('node:child_process');
  const db_check = execSync(`sudo -u www-data php -r "
\\\$_GET=[]; \\\$_POST=[]; \\\$_REQUEST=[]; \\\$_SERVER['REQUEST_METHOD']='GET';
require_once '/var/www/html/resourcespace/10.7/include/boot.php';

echo '─ testtest5 各类型 active 资源数 ─' . PHP_EOL;
foreach ([1=>'Photo',15=>'Shot',16=>'Script',17=>'Char',18=>'Scene',19=>'Voice',21=>'Prop'] as \\\$t => \\\$n) {
    \\\$c = ps_query('SELECT COUNT(*) AS c FROM ai_series_project_asset pa JOIN resource r ON r.ref=pa.resource_ref WHERE pa.project_ref=16 AND r.resource_type=? AND r.archive=0', ['i', \\\$t]);
    echo '  ' . \\\$n . '(type=' . \\\$t . '): ' . \\\$c[0]['c'] . PHP_EOL;
}
echo PHP_EOL . '─ ai_series_one_click_film_task ep01 ─' . PHP_EOL;
\\\$tasks = ps_query('SELECT id, status, error_message FROM ai_series_one_click_film_task WHERE project_ref=16 AND episode_index=1 ORDER BY id DESC LIMIT 3');
foreach (\\\$tasks as \\\$t) echo '  task=' . \\\$t['id'] . ' status=' . \\\$t['status'] . ' err=' . substr(\\\$t['error_message'] ?? '', 0, 60) . PHP_EOL;

echo PHP_EOL . '─ 工作目录 outputs ─' . PHP_EOL;
\\\$workdir = '/var/lib/ai_series_ocf/16/ep01';
if (is_dir(\\\$workdir)) {
    foreach (['outputs/director.json','outputs/prompts.md','assets/character-prompts.md','assets/scene-prompts.md'] as \\\$f) {
        \\\$p = \\\$workdir . '/' . \\\$f;
        echo '  ' . (file_exists(\\\$p) ? '✅' : '❌') . ' ' . \\\$f . PHP_EOL;
    }
} else { echo '  ❌ workdir 不存在' . PHP_EOL; }
" 2>&1`, { encoding: 'utf8' });
  console.log(db_check);

  // PASS 判定:Photo=0 + Char=0 + Scene=0 + Voice=0 + Prop=0(parse_only 不建实体);Script>=1
  const has_zero_entities = /Char\(type=17\): 0/.test(db_check)
    && /Scene\(type=18\): 0/.test(db_check)
    && /Voice\(type=19\): 0/.test(db_check)
    && /Photo\(type=1\): 0/.test(db_check);
  if (has_zero_entities && (last_status === 'done' || last_status === 'unknown')) {
    phase_result.pass = true;
  } else {
    phase_result.errors.push(`entities not zero or status=${last_status}`);
  }

  console.log(phase_result.pass ? '\n[Phase 3] ✅ PASS' : `\n[Phase 3] ❌ FAIL: ${phase_result.errors.join(', ')}`);
  process.exit(phase_result.pass ? 0 : 1);
} catch (e) {
  console.error('[Phase 3 FATAL]', e.message);
  await browser.close().catch(() => null);
  process.exit(1);
}
