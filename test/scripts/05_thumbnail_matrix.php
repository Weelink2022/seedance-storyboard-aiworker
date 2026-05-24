<?php
/**
 * Phase 5 — 9 类资源缩略图矩阵
 * 对 testtest5 项目下每类资源抽样 3 个,检查缩略图是否被降级。
 * 用法: sudo -u www-data php "/root/Seedance 2.0 分镜师团队/test/scripts/05_thumbnail_matrix.php"
 */
require_once __DIR__ . '/_db_helpers.php';

echo "═══ Phase 5 — 9 类资源缩略图矩阵 ═══\n\n";

// 类型 → 缩略图来源期望
// 'direct' = 自身应有缩略图(jpg/png/Puppeteer 渲染);'via_photo' = 实体自身无图,通过关联 Photo 显示
$types = [
    1  => ['name' => 'Photo',     'source' => 'direct'],
    2  => ['name' => 'Pt 卡',     'source' => 'direct'],   // §51c 重写
    3  => ['name' => 'Video',     'source' => 'direct'],   // ffmpeg 抽帧
    5  => ['name' => 'HTML',      'source' => 'direct'],   // Puppeteer
    15 => ['name' => 'Shot',      'source' => 'direct'],   // Puppeteer txt → png
    16 => ['name' => 'Script',    'source' => 'direct'],   // 同
    17 => ['name' => 'Character', 'source' => 'via_photo'], // 实体自身无图
    18 => ['name' => 'Scene',     'source' => 'via_photo'],
    19 => ['name' => 'Voice',     'source' => 'via_photo'], // 占位 svg
    20 => ['name' => 'Audio',     'source' => 'direct'],   // 音频占位/波形
    21 => ['name' => 'Prop',      'source' => 'via_photo'],
];

$report_md = "# Phase 5 缩略图降级检查报告\n\n生成于 " . date('c') . "\n\n";
$report_md .= "## 矩阵\n\n| 类型 | type | source | ref | has_image | thm 文件 | 大小 | 维度 | 状态 |\n";
$report_md .= "|---|---|---|---|---|---|---|---|---|\n";

foreach ($types as $type => $meta) {
    $label = $meta['name'];
    $source = $meta['source'];

    // testtest5 项目下该类型抽样 3 个 active 资源
    $rows = ps_query("
        SELECT DISTINCT r.ref, r.field8
        FROM resource r
        LEFT JOIN ai_series_project_asset pa ON pa.resource_ref = r.ref AND pa.project_ref = ?
        LEFT JOIN collection_resource cr ON cr.resource = r.ref
        LEFT JOIN ai_series_tree t ON t.collection_ref = cr.collection AND t.company_ref = ?
        WHERE r.resource_type = ? AND r.archive = 0
          AND (pa.resource_ref IS NOT NULL OR t.ref IS NOT NULL)
        ORDER BY r.ref
        LIMIT 3
    ", ['i', TEST_PROJECT_REF, 'i', TEST_COMPANY_REF, 'i', $type]);

    if (empty($rows)) {
        echo "$label (type=$type, $source): testtest5 下无 active 资源\n";
        $report_md .= "| $label | $type | $source | — | — | — | — | — | (无样本) |\n";
        continue;
    }

    echo "\n─── $label (type=$type, source=$source) ───\n";
    foreach ($rows as $r) {
        $ref = (int) $r['ref'];
        $info = ai_test_thumbnail_check($ref);

        if ($source === 'via_photo') {
            // 实体 — 看是否有关联 Photo
            $related = ps_query("
                SELECT DISTINCT IF(rr.resource=?, rr.related, rr.resource) AS related_ref
                FROM resource_related rr
                WHERE (rr.resource=? OR rr.related=?)
            ", ['i', $ref, 'i', $ref, 'i', $ref]);
            $has_photo = false;
            $first_photo_thm = null;
            foreach ($related as $rel) {
                $rel_ref = (int) $rel['related_ref'];
                $rel_data = ps_query("SELECT resource_type, archive, has_image FROM resource WHERE ref=?", ['i', $rel_ref]);
                if (!empty($rel_data) && (int)$rel_data[0]['resource_type'] === 1 && (int)$rel_data[0]['archive'] === 0 && (int)$rel_data[0]['has_image'] === 1) {
                    $has_photo = true;
                    $first_photo_thm = ai_test_thumbnail_check($rel_ref);
                    break;
                }
            }
            $degraded = !$has_photo;
            $dim_str = $has_photo && is_array($first_photo_thm['thm_dims']) ? "{$first_photo_thm['thm_dims'][0]}×{$first_photo_thm['thm_dims'][1]}" : '—';
            $mark = $degraded ? '❌ 无关联 Photo' : '✅ 通过 Photo';
            echo "  ref=$ref has_related_photo=" . ($has_photo ? 'Y' : 'N') . " photo_dims=$dim_str $mark title=" . substr($r['field8'] ?? '', 0, 30) . "\n";
            $report_md .= sprintf("| %s | %d | %s | %d | %s | — | — | %s | %s |\n",
                $label, $type, $source, $ref,
                $has_photo ? '✅ 有 Photo' : '❌ 无',
                $dim_str,
                $mark
            );
        } else {
            // 直接缩略图(自身有图)
            $degraded = (
                $info['has_image'] === 0
                || !$info['thm_exists']
                || $info['thm_size_bytes'] < 500
                || (is_array($info['thm_dims']) && $info['thm_dims'][0] <= 50)
            );
            $dim_str = is_array($info['thm_dims']) ? "{$info['thm_dims'][0]}×{$info['thm_dims'][1]}" : '?';
            $mark = $degraded ? '❌ 降级' : '✅';
            echo "  ref=$ref has_image={$info['has_image']} thm_exists=" . ($info['thm_exists'] ? 'Y' : 'N')
                . " bytes={$info['thm_size_bytes']} dims=$dim_str $mark"
                . ' title=' . substr($r['field8'] ?? '', 0, 30) . "\n";
            $report_md .= sprintf("| %s | %d | %s | %d | %d | %s | %d | %s | %s |\n",
                $label, $type, $source, $ref, $info['has_image'],
                $info['thm_exists'] ? '✅' : '❌',
                $info['thm_size_bytes'],
                $dim_str,
                $mark
            );
        }
    }
}

$report_file = '/root/Seedance 2.0 分镜师团队/test/reports/thumbnail_matrix_' . date('Y-m-d_His') . '.md';
file_put_contents($report_file, $report_md);
echo "\n\n📄 报告写入: $report_file\n";
