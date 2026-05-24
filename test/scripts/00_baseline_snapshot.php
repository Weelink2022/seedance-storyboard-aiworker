<?php
/**
 * Phase 0 — testtest5 基线 DB 快照 + 全系统健康审计
 * 用法: sudo -u www-data php "/root/Seedance 2.0 分镜师团队/test/scripts/00_baseline_snapshot.php" [snapshot_name]
 *   snapshot_name 默认 snapshot_0_baseline
 */
require_once __DIR__ . '/_db_helpers.php';

$name = $argv[1] ?? 'snapshot_0_baseline';
$out_file = '/root/Seedance 2.0 分镜师团队/test/snapshots/' . $name . '.json';

echo "═══ Phase 0 — DB 快照 ($name) ═══\n\n";

$project = ai_test_project_snapshot(TEST_PROJECT_REF);
$audit = ai_test_system_audit();

$snapshot = [
    'name' => $name,
    'timestamp' => date('c'),
    'project' => $project,
    'system_audit' => $audit,
];

file_put_contents($out_file, json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
echo "✅ 写入: $out_file\n\n";

echo "─── testtest5 项目状态 ───\n";
echo "tree by type:\n";
foreach ($project['tree_by_type'] as $t => $n) echo "  $t: $n\n";

echo "\nproject_asset by type+archive:\n";
foreach ($project['project_asset_by_type'] as $k => $n) echo "  $k: $n\n";

echo "\nepisodes: " . count($project['episodes']) . "\n";
foreach ($project['episodes'] as $e) echo "  ep_num={$e['ep_num']} title={$e['title']}\n";

echo "\nPt cards: " . count($project['pt_cards']) . "\n";
foreach ($project['pt_cards'] as $p) echo "  ref={$p['ref']} has_image={$p['has_image']} title={$p['title']}\n";

echo "\n─── 全系统健康 ───\n";
foreach ($audit as $k => $v) {
    $ok = $v === 0 ? '✅' : '❌';
    echo "  $ok $k = $v\n";
}

$all_clean = ($audit['cross_tenant_orphan_collections'] === 0
    && $audit['archive3_leak_links'] === 0
    && $audit['tree_dead_refs'] === 0
    && $audit['project_asset_dead_refs'] === 0);
echo "\n" . ($all_clean ? "✅ 基线干净" : "⚠️ 基线已有脏数据 — 请先修复再跑后续 phase") . "\n";
exit($all_clean ? 0 : 1);
