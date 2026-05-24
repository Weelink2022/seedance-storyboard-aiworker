<?php
/**
 * 共用 DB 辅助 — 供 00_baseline_snapshot.php / 08_final_audit.php / 05_thumbnail_matrix.php 调用。
 */

if (!defined('AI_TEST_HELPERS_LOADED')) {
    define('AI_TEST_HELPERS_LOADED', true);
    chdir('/var/www/html/resourcespace/10.7/pages');
    $_GET = []; $_POST = []; $_REQUEST = []; $_SERVER['REQUEST_METHOD'] = 'GET';
    require_once '/var/www/html/resourcespace/10.7/include/boot.php';
}

const TEST_PROJECT_REF = 16;     // testtest5
const TEST_COMPANY_REF = 4;      // 悦年轻
const TEST_EP_NUM     = 99;      // 测试集次编号
const TEST_EP_TITLE   = 'E2E测试集';
const TEST_SCENE_NAME = 'E2E测试场1';

/**
 * 拿一个项目的完整状态快照。
 */
function ai_test_project_snapshot(int $project_ref): array
{
    // tree 节点分布
    $tree_by_type = [];
    $rows = ps_query("
        SELECT t.node_type, COUNT(*) AS n
        FROM ai_series_tree t
        WHERE t.company_ref = (SELECT company_ref FROM ai_series_project WHERE ref = ?)
          AND (t.ref IN (
              SELECT ref FROM ai_series_tree WHERE node_type='project' AND JSON_EXTRACT(meta_json, '$.v1_project_ref') = ?
          )
          OR t.parent_ref IN (
              SELECT ref FROM ai_series_tree WHERE node_type='project' AND JSON_EXTRACT(meta_json, '$.v1_project_ref') = ?
          )
          OR t.parent_ref IN (
              SELECT t2.ref FROM ai_series_tree t2 WHERE t2.parent_ref IN (
                  SELECT ref FROM ai_series_tree WHERE node_type='project' AND JSON_EXTRACT(meta_json, '$.v1_project_ref') = ?
              )
          ))
        GROUP BY t.node_type
    ", ['i', $project_ref, 's', (string)$project_ref, 's', (string)$project_ref, 's', (string)$project_ref]);
    foreach ($rows as $r) $tree_by_type[$r['node_type']] = (int) $r['n'];

    // project_asset
    $pa_by_type = [];
    $rows = ps_query("
        SELECT r.resource_type, r.archive, COUNT(*) AS n
        FROM ai_series_project_asset pa
        JOIN resource r ON r.ref = pa.resource_ref
        WHERE pa.project_ref = ?
        GROUP BY r.resource_type, r.archive
    ", ['i', $project_ref]);
    foreach ($rows as $r) {
        $key = "type{$r['resource_type']}_archive{$r['archive']}";
        $pa_by_type[$key] = (int) $r['n'];
    }

    // episode 数
    $ep = ps_query("SELECT ref, ep_num, title FROM ai_series_episode WHERE project_ref = ? ORDER BY ep_num", ['i', $project_ref]);
    $episodes = array_map(fn($r) => ['ref' => (int)$r['ref'], 'ep_num' => $r['ep_num'], 'title' => $r['title']], $ep);

    // collection
    $proj_coll = ai_series_get_project_collection_map($project_ref);
    $coll_map = [];
    foreach ($proj_coll as $k => $v) {
        if (is_int($v)) $coll_map[$k] = (int) $v;
    }

    // Pt 卡(prompt_library collection 里)
    $pt_cards = [];
    if (!empty($coll_map['prompt_library'])) {
        $rows = ps_query("
            SELECT r.ref, r.field8, r.has_image, r.archive
            FROM collection_resource cr
            JOIN resource r ON r.ref = cr.resource
            WHERE cr.collection = ? AND r.resource_type = 2 AND r.archive = 0
            ORDER BY r.ref
        ", ['i', (int)$coll_map['prompt_library']]);
        foreach ($rows as $r) {
            $pt_cards[] = [
                'ref' => (int)$r['ref'],
                'title' => $r['field8'],
                'has_image' => (int)$r['has_image'],
            ];
        }
    }

    return [
        'project_ref' => $project_ref,
        'timestamp' => date('c'),
        'tree_by_type' => $tree_by_type,
        'project_asset_by_type' => $pa_by_type,
        'episodes' => $episodes,
        'collection_map' => $coll_map,
        'pt_cards' => $pt_cards,
    ];
}

/**
 * 全系统健康审计 — §51 / §51b / 死引用。
 */
function ai_test_system_audit(): array
{
    $a = [];

    // §51 跨租户孤儿
    $r = ps_query("SELECT COUNT(*) AS n FROM collection WHERE type=4 AND user=1 AND ref NOT IN (SELECT collection_ref FROM ai_series_tree WHERE collection_ref>0)");
    $a['cross_tenant_orphan_collections'] = (int) $r[0]['n'];

    // §51b archive=3 漏网挂载
    $r = ps_query("SELECT COUNT(*) AS n FROM collection_resource cr JOIN resource r ON r.ref=cr.resource WHERE r.archive=3");
    $a['archive3_leak_links'] = (int) $r[0]['n'];

    // ai_series_tree 死引用
    $r = ps_query("SELECT COUNT(*) AS n FROM ai_series_tree t WHERE t.collection_ref > 0 AND NOT EXISTS (SELECT 1 FROM collection c WHERE c.ref = t.collection_ref)");
    $a['tree_dead_refs'] = (int) $r[0]['n'];

    // ai_series_project_asset 指向已不存在的 resource
    $r = ps_query("SELECT COUNT(*) AS n FROM ai_series_project_asset pa WHERE NOT EXISTS (SELECT 1 FROM resource r WHERE r.ref = pa.resource_ref)");
    $a['project_asset_dead_refs'] = (int) $r[0]['n'];

    return $a;
}

/**
 * 拿 RS 资源缩略图路径 + 文件存在性 + 像素维度。
 */
function ai_test_thumbnail_check(int $ref): array
{
    $info = ['ref' => $ref, 'has_image' => null, 'thm_path' => null, 'thm_exists' => false, 'thm_size_bytes' => 0, 'thm_dims' => null];
    $r = ps_query("SELECT has_image, file_extension, preview_extension, thumb_width, thumb_height FROM resource WHERE ref = ?", ['i', $ref]);
    if (empty($r)) return $info + ['error' => 'resource not found'];

    $info['has_image'] = (int) $r[0]['has_image'];
    $info['preview_ext'] = $r[0]['preview_extension'];
    $info['thumb_w_db'] = (int) $r[0]['thumb_width'];
    $info['thumb_h_db'] = (int) $r[0]['thumb_height'];

    if (function_exists('get_resource_path')) {
        $thm = get_resource_path($ref, true, 'thm', false, 'jpg');
        $info['thm_path'] = $thm;
        if (is_string($thm) && file_exists($thm)) {
            $info['thm_exists'] = true;
            $info['thm_size_bytes'] = filesize($thm);
            $sz = @getimagesize($thm);
            if ($sz) $info['thm_dims'] = [$sz[0], $sz[1]];
        }
    }
    return $info;
}

/**
 * 一句话 echo 表头 + 数据(用于命令行查看)。
 */
function ai_test_print_table(array $rows, array $cols): void
{
    if (empty($rows)) { echo "(empty)\n"; return; }
    $widths = [];
    foreach ($cols as $c) $widths[$c] = strlen($c);
    foreach ($rows as $r) foreach ($cols as $c) {
        $v = (string) ($r[$c] ?? '');
        if (strlen($v) > $widths[$c]) $widths[$c] = min(strlen($v), 40);
    }
    $line = function($row) use ($cols, $widths) {
        $parts = [];
        foreach ($cols as $c) {
            $v = (string) ($row[$c] ?? '');
            $parts[] = mb_str_pad($v, $widths[$c]);
        }
        return implode(' | ', $parts);
    };
    echo $line(array_combine($cols, $cols)) . "\n";
    echo str_repeat('-', array_sum($widths) + 3 * (count($cols) - 1)) . "\n";
    foreach ($rows as $r) echo $line($r) . "\n";
}

if (!function_exists('mb_str_pad')) {
    function mb_str_pad(string $s, int $w, string $pad = ' '): string {
        $len = mb_strlen($s);
        if ($len >= $w) return $s;
        return $s . str_repeat($pad, $w - $len);
    }
}
