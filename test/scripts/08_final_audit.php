<?php
/**
 * Phase 8 — 终态对齐 + 跨租户审计 + diff snapshot_0 vs snapshot_8
 */
require_once __DIR__ . '/_db_helpers.php';

echo "═══ Phase 8 — 终态审计 ═══\n\n";

// 拿 snapshot_8
$project = ai_test_project_snapshot(TEST_PROJECT_REF);
$audit = ai_test_system_audit();
$snap8 = ['name' => 'snapshot_8_final', 'timestamp' => date('c'), 'project' => $project, 'system_audit' => $audit];

$snap_file = '/root/Seedance 2.0 分镜师团队/test/snapshots/snapshot_8_final.json';
file_put_contents($snap_file, json_encode($snap8, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
echo "💾 写入: $snap_file\n\n";

// 加载 snapshot_0
$snap0_file = '/root/Seedance 2.0 分镜师团队/test/snapshots/snapshot_0_baseline.json';
if (!file_exists($snap0_file)) {
    echo "❌ snapshot_0_baseline.json 不存在 — 先跑 Phase 0\n";
    exit(1);
}
$snap0 = json_decode(file_get_contents($snap0_file), true);

// 全系统健康
echo "─── 全系统健康(8 vs 0) ───\n";
$health_pass = true;
foreach ($audit as $k => $v8) {
    $v0 = $snap0['system_audit'][$k] ?? '?';
    $ok = $v8 === 0;
    $health_pass = $health_pass && $ok;
    echo sprintf("  %-40s baseline=%s final=%d %s\n", $k, $v0, $v8, $ok ? '✅' : '❌');
}

// project tree 对比
echo "\n─── testtest5 tree_by_type 对比 ───\n";
$tree_pass = true;
$all_keys = array_unique(array_merge(array_keys($snap0['project']['tree_by_type']), array_keys($project['tree_by_type'])));
foreach ($all_keys as $k) {
    $v0 = $snap0['project']['tree_by_type'][$k] ?? 0;
    $v8 = $project['tree_by_type'][$k] ?? 0;
    $eq = $v0 === $v8;
    $tree_pass = $tree_pass && $eq;
    echo sprintf("  %-15s baseline=%d final=%d %s\n", $k, $v0, $v8, $eq ? '✅' : '⚠️');
}

// project_asset 对比 — 只严判 active(archive=0);archive=3 增长视为 reset 软删保留,合理
echo "\n─── testtest5 project_asset_by_type 对比 ───\n";
$pa_pass = true;
$all_keys = array_unique(array_merge(array_keys($snap0['project']['project_asset_by_type']), array_keys($project['project_asset_by_type'])));
foreach ($all_keys as $k) {
    $v0 = $snap0['project']['project_asset_by_type'][$k] ?? 0;
    $v8 = $project['project_asset_by_type'][$k] ?? 0;
    $eq = $v0 === $v8;
    $is_archived_bucket = (strpos($k, '_archive3') !== false);
    if ($is_archived_bucket) {
        // archive=3 增长合理(reset 软删保留 + OCF 产物 archive)
        $note = $eq ? '✅' : ($v8 >= $v0 ? '✅ 增长合理(软删保留)' : '⚠️ 反向减少');
        // 不影响 pa_pass(只看 active 桶)
    } else {
        $note = $eq ? '✅' : '❌';
        $pa_pass = $pa_pass && $eq;
    }
    echo sprintf("  %-25s baseline=%d final=%d %s\n", $k, $v0, $v8, $note);
}

// episodes
echo "\n─── episodes 对比 ───\n";
$ep0 = array_map(fn($e) => $e['ep_num'], $snap0['project']['episodes']);
$ep8 = array_map(fn($e) => $e['ep_num'], $project['episodes']);
$ep_pass = ($ep0 === $ep8);
echo '  baseline: ' . implode(',', $ep0) . "\n";
echo '  final:    ' . implode(',', $ep8) . "\n";
echo '  ' . ($ep_pass ? '✅ 一致' : '❌ 不一致') . "\n";

// Pt 卡
echo "\n─── Pt 卡 6 张对比 ───\n";
$pt0 = array_map(fn($p) => $p['ref'], $snap0['project']['pt_cards']);
$pt8 = array_map(fn($p) => $p['ref'], $project['pt_cards']);
$pt_pass = ($pt0 === $pt8);
echo '  baseline refs: ' . implode(',', $pt0) . "\n";
echo '  final refs:    ' . implode(',', $pt8) . "\n";
echo '  ' . ($pt_pass ? '✅ 6 张未动' : '❌ Pt 卡被改了') . "\n";

// 终结
$all_pass = $health_pass && $tree_pass && $pa_pass && $ep_pass && $pt_pass;
echo "\n═══════════════════════════════════════════\n";
echo $all_pass
    ? "✅ PASS — 终态完全对齐基线,§51 + §51b + §51c 全部健康\n"
    : "❌ FAIL — 看上面 ⚠️/❌ 项\n";
echo "═══════════════════════════════════════════\n";
exit($all_pass ? 0 : 1);
