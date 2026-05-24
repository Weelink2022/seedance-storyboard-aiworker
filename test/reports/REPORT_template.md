# E2E 测试报告 — {{执行日期}}

> **执行人**:
> **执行时长**:
> **环境**:RS 10.7 + nanobanana + seedance 2.0(本次未跑)
> **方案版本**:[E2E测试方案_section52.md](../E2E测试方案_section52.md) v2

## 总结

| Phase | 名称 | 状态 | 备注 |
|---|---|---|---|
| 0 | 基线快照 | ⏳ | snapshots/snapshot_0_baseline.json |
| 1 | 漫控台新建集次 → 剧集侧验证 | ⏳ | |
| 2 | 剧集侧新建场次 → 漫控台验证 | ⏳ | |
| 3 | OCF 仅解析 mock | ⏳ | 需确认勾「仅解析」 |
| 4 | 重置数据(ep01)+ 级联删验证 | ⏳ | |
| 5 | 9 类资源缩略图矩阵 | ⏳ | reports/thumbnail_matrix_*.md |
| 6 | 缩略图主动再生 | ⏳ | |
| 7 | 删除回路 + 还原基线 | ⏳ | |
| 8 | 终态对齐 + 跨租户审计 | ⏳ | |

## 缩略图降级矩阵(Phase 5)

| 类型 | type | 样本 ref | 是否降级 |
|---|---|---|---|
| Photo | 1 | | |
| Pt | 2 | | |
| Video | 3 | | |
| HTML | 5 | | |
| Shot | 15 | | |
| Script | 16 | | |
| Character | 17 | | |
| Scene | 18 | | |
| Voice | 19 | | |
| Audio | 20 | | |
| Prop | 21 | | |

## 跨租户验证(664534335 视角)

| 检查项 | 结果 |
|---|---|
| 「我的收藏夹」是否含 testtest5 | |
| browsebar 是否含 testtest5 collection | |
| 精选合集是否含 testtest5 内容 | |

## 双边一致性验证

| 操作 | 漫控台 ↔ 剧集侧 |
|---|---|
| Phase 1 新建集次 ep99 | |
| Phase 2 新建场次 E2E测试场1 | |
| Phase 3 OCF 产物 Script | |
| Phase 4 reset 后清空 | |
| Phase 7 删除 ep99 | |

## 发现的问题

(填新发现的 bug,关联到 §53 / §54 ...)

## 修复建议

(若发现新问题,列优先级)

## 截图证据

参见 `screenshots/` 目录,每 phase 至少一张关键截图。

## DB 快照对比

`snapshot_0_baseline.json` vs `snapshot_8_final.json` 见 Phase 8 输出。
