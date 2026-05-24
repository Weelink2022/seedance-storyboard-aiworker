# E2E 测试方案 §52(漫控台 ↔ 剧集侧 双边数据审计)

> **方案版本**:v2 (2026-05-24)
> **覆盖范围**:§22 OCF / §41 voice / §46c 出图建实体 / §48 归并 / §50 Pt 模板 / §51 collection 级联删 / §51b archive=3 漏网 / §51c Pt 内容感知缩略图
> **测试目标**:
>   1. **双边数据一致** — 漫控台操作后剧集侧能看到,反之亦然
>   2. **缩略图非降级** — 9 类资源缩略图不是 fallback 占位
>   3. **跨租户隔离** — 664534335 视角看不到 muyaowu 任何项目数据
>   4. **可重复** — 测完回到基线状态,下次能再跑

---

## 测试账号

| 角色 | 账号 | 公司 | 用途 |
|---|---|---|---|
| 主操作 | muyaowu713001@gmail.com / Cholesteric2012# | 悦年轻 (4) | testtest5 全流程 |
| 串扰观察 | 664534335@qq.com / 6122024oK# | 佰乐康健 (2) | 平行只读观察 |

## Mock 策略(不烧 token)

| 项 | 怎么 mock |
|---|---|
| OCF LLM 调用 | 勾「☐ 仅解析(无 AGI)」→ 后端 `__PARSE_ONLY__` 短路,不调 LLM |
| 出图 nanobanana | 同上 → 不调 ai_series_create_asset_output 出图分支 |
| seedance 视频 | 不点「直接出图」C 模式,主流程跳过 seedance |
| 缩略图 | 本地 generate-pt-thumbnail.php(免外部 API) |
| 新建集次/场次 | RS modal POST(免外部 API) |
| 重置数据 | 调 ai_series_ocf_reset_project_episode(免外部 API) |

## 你可同步观察的方式

- **Playwright `headless: false`**:你能看到浏览器实时操作
- **截图实时落** `/root/Seedance 2.0 分镜师团队/test/screenshots/`
- **你可以自己开浏览器** 用 664534335 平行登录(RS 允许多端)
- 我在每 Phase 输出 console log + 中间 pause 给你看屏

---

## 关键资源类型清单(必须每类都验证缩略图)

| 类型 | resource_type | 文件 ext | 缩略图来源 | 期望表现 |
|---|---|---|---|---|
| Photo | 1 | jpg/png | RS preview 流水线 | 真出图缩略图 |
| Pt 卡 | 2 | json | `generate-pt-thumbnail.php`(§51c 重写) | indigo 色条 + 卡内容 |
| Video | 3 | mp4 | ffmpeg 抽帧 | 视频帧 |
| HTML | 5 | html | `generate-html-thumbnail.php` | 内容感知 |
| Shot | 15 | txt | Puppeteer 渲染 txt → png(`generate-prompt-screenshot-*.js`) | 分镜文案预览 |
| Script | 16 | txt | RS 文本预览 / Puppeteer | 剧本文本预览 |
| Character | 17 | — | 自身无文件,通过 resource_related Photo 显示 | 关联人物照片 |
| Scene | 18 | — | 同上,关联场景照片 | 关联场景照片 |
| Voice | 19 | — | 占位音频 svg | `/plugins/ai_series/img/voice-thumb.svg` |
| Audio | 20 | mp3/wav | 占位/波形 | 占位 |
| Prop | 21 | — | 同 Character,关联道具照片 | 关联道具照片 |

**缩略图降级 = 显示 RS 默认灰色文档图标**(`gfx/no_preview/no_preview.png` 或类似)。任何一类降级即 FAIL。

---

## Phase 流程

### Phase 0 — 启动 & 基线快照

**目的**:留下 testtest5 的初始状态,后续每 phase 都跟它对比。

| Step | 操作 | 验证点 |
|---|---|---|
| 0.1 | Playwright 启动 chromium(headless: false 你能看到)+ muyaowu 登录 | 落 home.php |
| 0.2 | 截图 `phase_0_home.png` | 顶栏含 `AI Comic` + `剧集` |
| 0.3 | (你)用 664534335 浏览器平行登录 | 应见佰乐康健自家项目 |
| 0.4 | 漫控台路径进 testtest5(顶栏 AI Comic → drawer → 点项目卡)| iframe URL = `ai_series_prototype.html?project=16` |
| 0.5 | DB 快照 #0 写 `snapshots/snapshot_0_baseline.json`:<br>- testtest5 tree 节点数 / 按 node_type 分布<br>- testtest5 ai_series_project_asset 数<br>- testtest5 collection 数 / archive=3 资源数<br>- 6 张 Pt 卡 ref + has_image<br>- 全系统跨租户孤儿数(应 0)<br>- 全系统 archive=3 漏网挂载数(应 0) | baseline 干净 |
| 0.6 | 剧集侧路径(顶栏 剧集 → BrowseBar 展开 testtest5)截图 `phase_0_series.png` | 树展开正常 |

**输出**:`snapshots/snapshot_0_baseline.json` + 2 张截图

---

### Phase 1 — 漫控台「新建集次」→ 剧集侧验证

**目的**:漫控台 创建 → 剧集侧 同步可见。

| Step | 操作 | 验证点 |
|---|---|---|
| 1.1 | 漫控台 → testtest5 → 右侧 browsebar「新建剧集」按钮 | modal 弹出 |
| 1.2 | 填 ep_num=**99** title=**E2E测试集** → 提交 | 返回 success |
| 1.3 | (剧集侧验证)顶栏剧集 → testtest5 展开 → 是否出现「第99集 E2E测试集」 | ✅ 出现 |
| 1.4 | 点该集次,看子结构 | 含「+ 新建场次」+「分镜库」 |
| 1.5 | DB 双边校验:<br>- `ai_series_episode WHERE project_ref=16 AND ep_num=99` 1 行<br>- `ai_series_tree WHERE node_type='episode'` 新增 1 + 子节点 7<br>- 新建 collection.user=6 (muyaowu,**不是 admin**) | §51 col_user 修复后 |
| 1.6 | (你)664534335 刷新「我的收藏夹」+ browsebar | **不应**看到「E2E测试集」相关 collection |

---

### Phase 2 — 剧集侧「新建场次」→ 漫控台验证

**目的**:剧集侧 创建 → 漫控台 同步可见。

| Step | 操作 | 验证点 |
|---|---|---|
| 2.1 | 剧集侧 BrowseBar → testtest5 → 第99集 → 点「+ 新建场次」modal | 弹出 |
| 2.2 | 场次名=**E2E测试场1** scene_num=1 → 提交 | success |
| 2.3 | 漫控台:返回首页 → testtest5 → 分镜管理 → 选 ep99 | 出现「E2E测试场1」 |
| 2.4 | DB 双边校验:scene tree owner=6 + scene collection.user=6 | 不是 admin |
| 2.5 | (你)664534335 不可见 | ✅ |

---

### Phase 3 — OCF 仅解析(mock,核心)

**目的**:走 OCF 主流程但不烧 token。验证 §46c+§48「仅解析不建实体 + 归并 banner」。

| Step | 操作 | 验证点 |
|---|---|---|
| 3.1 | 漫控台 → testtest5 → 一键成片按钮(brand 右上 `#one-click-make-btn`)| OCF modal 弹 |
| 3.2 | 选集次 ep01 → **勾「仅解析(无 AGI)」**(必须确认勾上!)| checkbox checked |
| 3.3 | 点「开始一键成片」 | 任务启动 |
| 3.4 | 等任务完成(<60s)| step 全 done |
| 3.5 | DB 检查:`ai_series_one_click_film_task` 状态=done | ✅ |
| 3.6 | 检查工作目录:`/var/lib/ai_series_ocf/16/ep01/outputs/{director.json,prompts.md}` | 文件存在 |
| 3.7 | DB 检查:character/scene/prop/voice 实体数 | **0**(§46c 仅解析不建)|
| 3.8 | 漫控台 数字资产屏:顶部「📋 待归并清单 banner」| 出现 (§48) |
| 3.9 | 剧本库 collection 新增 Script 资源 | 4 个 |
| 3.10 | 缩略图初步检查:新 Script.has_image | 应为 1 |
| 3.11 | (你)664534335 不可见 testtest5 新 Script | ✅ |

---

### Phase 4 — 重置数据(级联删验证)

**目的**:验证 §51 helper + §22/§37/§41/§48 reset 范围。

| Step | 操作 | 验证点 |
|---|---|---|
| 4.1 | 漫控台 → OCF modal → 「重置数据」按钮 → 二级 modal | 弹出 |
| 4.2 | 选「仅当集 ep01」→ 确认 | notify 显示删除统计 |
| 4.3 | DB 审计(关键):<br>- archive=3 资源 collection 挂载数:**0** (§51b)<br>- 全系统跨租户孤儿 type=4 collection:**0** (§51)<br>- ep01 scene tree 节点:**0**(被级联删)<br>- ep01 shot tree 节点:**0**<br>- Pt 卡 6 张:**未动** (ref=103959-103964 仍 active)<br>- 工作目录 outputs/ 是否清空 | 全部 ✅ |
| 4.4 | 漫控台 归并 banner 消失 | ✅ |
| 4.5 | 剧集侧 testtest5 ep01 场次列表清空 | ✅ |
| 4.6 | (你)664534335 平行 0 串扰 | ✅ |

---

### Phase 5 — 每类资源缩略图全覆盖(关键)

**目的**:9 类资源缩略图,逐一检查是否被降级。

#### 5.A 缩略图矩阵生成

跑 `scripts/05_thumbnail_matrix.php`,对 testtest5 项目下每种类型抽样 3 个资源,生成表格:

| 资源 ref | type | has_image | 磁盘 thm 存在 | HTTP 200 | 像素 W×H | 是否降级 | 验证地点 |
|---|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | ... | ... |

**降级判定**:
- ❌ has_image=0
- ❌ 磁盘 thm 文件不存在
- ❌ HTTP 拿到的图 < 500 字节(典型 RS 默认占位)
- ❌ 像素 ≤ 50×50(典型小占位)
- ❌ 图内容跟 `gfx/no_preview/no_preview.png` 哈希一致

#### 5.B Playwright UI 验证

每个 tab(漫控台 + 剧集侧),截图 `phase_5_<tab>_<location>.png`,人肉判定:
- 漫控台 数字资产屏:characters/scenes/voices/props/prompts 5 tab
- 剧集侧 RS 主搜索:!collection<X> 进各资产库

#### 5.C 双边一致检查

每个 tab,记录:
- 漫控台拿的缩略图 URL
- 剧集侧拿的缩略图 URL
- 比对:同 ref 应是同一张图(URL 可能不同但内容一致)

---

### Phase 6 — 缩略图主动再生

**目的**:验证缩略图链路可重生(改 JSON → 缩略图反映新内容)。

| Step | 操作 | 验证点 |
|---|---|---|
| 6.1 | 拿 testtest5 人物提示词库(103959)JSON,加一条新 item | 写文件 |
| 6.2 | 调 `php /root/tldraw-local-server/generate-pt-thumbnail.php 103959` | 4 个尺寸全生成 |
| 6.3 | 漫控台 + 剧集侧刷新,看新缩略图是否含新 item | 防缓存:URL 加 `&v=<ts>` |

---

### Phase 7 — 删除回路(漫控台 ↔ 剧集侧)

**目的**:验证双边删除同步 + 级联删 collection。

| Step | 操作 | 验证点 |
|---|---|---|
| 7.1 | 剧集侧:右键「E2E测试场1」→ 删除场次 | confirm |
| 7.2 | DB 检查:scene tree 节点删除 + scene collection 也删除(§51 helper) | ✅ |
| 7.3 | 漫控台 分镜管理 刷新:E2E测试场1 消失 | ✅ |
| 7.4 | 漫控台:删除「第99集 E2E测试集」(在 episode 节点的删除入口) | confirm |
| 7.5 | DB 检查:episode tree + 7 子节点 + 它们的 collection 全部级联删除 | ✅ |
| 7.6 | 剧集侧 testtest5 展开:第99集消失 | ✅ |
| 7.7 | DB 全系统审计:0 孤儿 + 0 死引用 + 0 漏网挂载 | ✅ |

---

### Phase 8 — 最终基线对齐 + 跨租户审计

**目的**:回到基线状态 + 出最终报告。

| Step | 操作 | 验证点 |
|---|---|---|
| 8.1 | DB 快照 #8 写 `snapshots/snapshot_8_final.json` | |
| 8.2 | snapshot_0 vs snapshot_8 diff | **差异 = 0**(每类计数对齐) |
| 8.3 | (你)664534335 全屏截图:browsebar + 我的收藏夹 + 精选合集 | 0 张 muyaowu 内容 |
| 8.4 | 漫控台 + 剧集侧 testtest5 各截图 | 跟 Phase 0 对齐 |
| 8.5 | 生成 `reports/REPORT_<日期>.md` | 每 phase PASS/FAIL + 缩略图矩阵 |

---

## 失败处理

| 失败场景 | 处理 |
|---|---|
| Phase 3 「仅解析」未勾选 | Playwright `expect(checkbox).toBeChecked()` 不通过 → abort,**不点开始**,避免烧 token |
| Phase 4 reset 后还有孤儿 | abort,跑 §51b cleanup 脚本恢复 |
| Phase 7 删 episode 失败 | 手动 SQL 清理:DELETE FROM ai_series_episode WHERE ep_num=99 + DELETE 相关 tree + DELETE 相关 collection |
| 测试中途崩了 | 数据可能有残留,跑 `scripts/cleanup_test_data.php` 兜底 |

---

## 安全约束

1. **绝对禁止**:
   - 删除真实集次(ep01-ep20)
   - 删除真实项目
   - 修改 664534335 的任何数据
   - 跳过「仅解析」勾选

2. **可执行**:
   - 新建 ep_num=99 测试集
   - 新建 "E2E测试场*" 命名场次
   - 跑「重置数据」对 ep01(因为 ep01 是项目自带,reset 后会重建)

---

## 历史结果

| 日期 | 执行人 | 状态 | 报告 |
|---|---|---|---|
| (待跑) | - | - | reports/ |

---

## 跟修复章节的对应关系

| 测试 Phase | 验证的修复 |
|---|---|
| Phase 0 + 8 | §51 + §51b 修复后基线干净 |
| Phase 1 | §51 col_user 必传(新建集次 owner=真用户) |
| Phase 2 | 同上(scene tree) |
| Phase 3 | §46c 仅解析不建实体 + §48 归并 banner |
| Phase 4 | §22 + §37 + §41 + §48 reset 范围 + §51 级联删 |
| Phase 5 | §51c Pt 内容感知缩略图 + 9 类资源缩略图基线 |
| Phase 6 | §51c 缩略图链路可重生 |
| Phase 7 | §51 删 tree → 级联删 collection + DB 死引用 0 |
| Phase 8 | §51 + §51b + §51c 完整回归 |
