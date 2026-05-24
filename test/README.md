# AI 漫剧 E2E 测试套件

> **位置**:`/root/Seedance 2.0 分镜师团队/test/`
> **建立**:2026-05-24
> **目的**:验证漫控台 ↔ 剧集侧 双边数据一致性、缩略图非降级、跨租户隔离

---

## 目录结构

```
test/
├── README.md                       本文件 — 导航
├── E2E测试方案_section52.md       完整测试方案 v2(9 phases)
├── scripts/                        Playwright + PHP 脚本
│   ├── 00_baseline_snapshot.php    Phase 0 — DB 快照
│   ├── 01_create_episode.mjs       Phase 1 — 漫控台新建集次
│   ├── 02_create_scene.mjs         Phase 2 — 剧集侧新建场次
│   ├── 03_ocf_parse_only.mjs       Phase 3 — OCF mock(__PARSE_ONLY__)
│   ├── 04_reset_data.mjs           Phase 4 — 重置数据
│   ├── 05_thumbnail_matrix.php     Phase 5 — 9 类资源缩略图矩阵
│   ├── 06_thumbnail_regen.mjs      Phase 6 — 缩略图主动再生
│   ├── 07_delete_roundtrip.mjs     Phase 7 — 删除回路
│   ├── 08_final_audit.php          Phase 8 — 终态对齐 + 审计
│   ├── _common.mjs                 共用工具:登录、截图、frame 定位
│   └── _db_helpers.php             共用 DB 辅助函数
├── snapshots/                      DB 快照对比(JSON)
│   ├── snapshot_0_baseline.json
│   └── snapshot_8_final.json
├── screenshots/                    Playwright 截图证据
│   └── phase_<N>_*.png
├── mock_data/                      mock 输入数据
│   ├── testtest5_baseline_state.md  testtest5 初始状态描述
│   └── parse_only_flag_evidence.md  __PARSE_ONLY__ 短路逻辑代码引用
└── reports/                        测试结果
    └── REPORT_<日期>.md
```

---

## 快速运行

### 单 Phase

```bash
cd /root/my-tldraw-app  # Playwright 工作目录
node "/root/Seedance 2.0 分镜师团队/test/scripts/01_create_episode.mjs"
```

### 全流程(从 Phase 0 到 8)

```bash
cd "/root/Seedance 2.0 分镜师团队/test"
bash run_all.sh  # 待写
```

### 单做 DB 审计

```bash
sudo -u www-data php "/root/Seedance 2.0 分镜师团队/test/scripts/00_baseline_snapshot.php"
sudo -u www-data php "/root/Seedance 2.0 分镜师团队/test/scripts/08_final_audit.php"
```

---

## 账号

| 角色 | 账号 | 密码 |
|---|---|---|
| 主操作 | muyaowu713001@gmail.com | Cholesteric2012# |
| 串扰观察 | 664534335@qq.com | 6122024oK# |

---

## 关键约定

1. **不烧 token**:OCF 必须勾「仅解析(无 AGI)」否则 abort
2. **测试集次用 ep_num=99**:避开真集次
3. **测试场次名 "测试场1"** "测试场2":明显可识别
4. **跨租户验证由 664534335 视角**:只读不操作
5. **每个 Phase 失败立即 abort**:不再继续以免污染数据
6. **测试完跑 Phase 7+8 清理回基线**

---

## 跟其他文档的关系

- [E2E测试方案_section52.md](./E2E测试方案_section52.md) — 完整方案
- [/var/www/html/resourcespace/AI漫剧控制台进入路径.md](/var/www/html/resourcespace/AI漫剧控制台进入路径.md) — 漫控台进入步骤
- [/var/www/html/resourcespace/剧集进入路径.md](/var/www/html/resourcespace/剧集进入路径.md) — 剧集侧进入步骤
- [/root/Seedance 2.0 分镜师团队/漫剧Agents.md](/root/Seedance%202.0%20分镜师团队/漫剧Agents.md) §51 §51b §51c — 修复历史
- [/root/Seedance 2.0 分镜师团队/Seedance 2.0 分镜师团队/软删和真删.md](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/软删和真删.md) — 数据模型

---

## 历次执行记录

| 日期 | 执行人 | 报告 | PASS/FAIL |
|---|---|---|---|
| 2026-05-24 | (待跑) | reports/REPORT_2026-05-24.md | - |
