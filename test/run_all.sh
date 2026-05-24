#!/bin/bash
# Full E2E run — Phase 0 → 8 顺序跑完
# 用法: bash "/root/Seedance 2.0 分镜师团队/test/run_all.sh"
#
# 注意:
#   - Phase 3 (OCF) 必须人盯着,确保「仅解析」勾上
#   - 单 Phase 失败立即 abort
#   - 测完跑 Phase 7+8 还原基线
set -e

TEST_DIR="/root/Seedance 2.0 分镜师团队/test"
PW_DIR="/root/my-tldraw-app"

echo "═════════════════════════════════════════════"
echo "  AI 漫剧 E2E 测试 — Phase 0 → 8"
echo "  开始: $(date -Iseconds)"
echo "═════════════════════════════════════════════"

cd "$PW_DIR"

# Phase 0
echo ""
echo "▶ Phase 0 — 基线快照"
sudo -u www-data php "$TEST_DIR/scripts/00_baseline_snapshot.php" snapshot_0_baseline

# Phase 1
echo ""
echo "▶ Phase 1 — 漫控台新建集次"
node "$TEST_DIR/scripts/01_create_episode.mjs"

# Phase 2
echo ""
echo "▶ Phase 2 — 剧集侧新建场次"
node "$TEST_DIR/scripts/02_create_scene.mjs"

# Phase 3
echo ""
echo "▶ Phase 3 — OCF 仅解析 mock"
read -p "  ⚠️  即将跑 OCF — 请确认 testtest5 ep01 现在没在用,按回车继续(Ctrl+C 中断): "
node "$TEST_DIR/scripts/03_ocf_parse_only.mjs"

# 快照
sudo -u www-data php "$TEST_DIR/scripts/00_baseline_snapshot.php" snapshot_3_after_ocf

# Phase 4
echo ""
echo "▶ Phase 4 — 重置数据"
node "$TEST_DIR/scripts/04_reset_data.mjs"
sudo -u www-data php "$TEST_DIR/scripts/00_baseline_snapshot.php" snapshot_4_after_reset

# Phase 5
echo ""
echo "▶ Phase 5 — 缩略图矩阵"
sudo -u www-data php "$TEST_DIR/scripts/05_thumbnail_matrix.php"

# Phase 6
echo ""
echo "▶ Phase 6 — 缩略图主动再生"
node "$TEST_DIR/scripts/06_thumbnail_regen.mjs"

# Phase 7
echo ""
echo "▶ Phase 7 — 删除回路 + 还原基线"
node "$TEST_DIR/scripts/07_delete_roundtrip.mjs"

# Phase 8
echo ""
echo "▶ Phase 8 — 终态审计"
sudo -u www-data php "$TEST_DIR/scripts/08_final_audit.php"

echo ""
echo "═════════════════════════════════════════════"
echo "  全部完成: $(date -Iseconds)"
echo "  截图: $TEST_DIR/screenshots/"
echo "  快照: $TEST_DIR/snapshots/"
echo "  报告: $TEST_DIR/reports/"
echo "═════════════════════════════════════════════"
