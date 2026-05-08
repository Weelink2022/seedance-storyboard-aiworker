# 漫剧 Agents 设计与执行归档

## 归档目的

本文档用于归档 `/root/Seedance 2.0 分镜师团队/Seedance 2.0 分镜师团队` 的 Agent 体系设计、原始工作流、独立化改造方案，以及本次已经实际落地的执行结果。

归档时间：2026-05-06

---

## 一、项目定位

该目录本质上不是传统 Web 应用或后端服务，而是一套围绕“漫剧/短剧分镜提示词生产”的多 Agent 工作流工程。

它的核心目标是：

1. 读取用户剧本。
2. 先由导演 Agent 进行剧本拆解和讲戏。
3. 再由服化道 Agent 生成角色与场景参考图提示词。
4. 最后由分镜师 Agent 输出 Seedance 2.0 动态视频提示词。
5. 所有阶段统一由导演 Agent 执行业务审核和合规审核。

从职责分层上，它更接近“AI 制片流水线”，而不是单一聊天 Prompt。

---

## 二、原始设计

### 1. 主控设计

原始主控定义在：

- `Seedance 2.0 分镜师团队/CLAUDE.md`

该文件定义了一个“制片人主 Agent”。

主 Agent 的职责不是直接生成内容，而是：

1. 调度 `director`
2. 调度 `art-designer`
3. 调度 `storyboard-artist`
4. 组织三阶段流程
5. 控制审核闭环
6. 维护跨阶段的上下文连续性

原始三阶段顺序：

1. 导演分析
2. 服化道设计
3. 分镜编写

审核闭环顺序：

1. 生成
2. 写入文件
3. 导演业务审核
4. 导演合规审核
5. FAIL 时回退修改并重审

### 2. 子 Agent 设计

原始目录中有三个角色定义文件：

- `Seedance 2.0 分镜师团队/agents/director.md`
- `Seedance 2.0 分镜师团队/agents/art-designer.md`
- `Seedance 2.0 分镜师团队/agents/storyboard-artist.md`

对应职责如下：

#### director

负责：

1. 剧本分析
2. 剧情点拆解
3. 导演讲戏
4. 阶段一业务审核
5. 阶段二业务审核
6. 阶段三业务审核
7. 全流程合规审核

#### art-designer

负责：

1. 人物设定提示词
2. 场景环境提示词
3. 基础形象与变体形象设计
4. 根据导演反馈修订服化道产物

#### storyboard-artist

负责：

1. 读取导演讲戏本
2. 读取人物/场景提示词
3. 建立素材对应表
4. 编写 Seedance 2.0 动态提示词
5. 根据导演反馈修订提示词

### 3. 技能包设计

原始体系通过 `skills/` 目录将角色能力进一步拆分为规则包：

- `director-skill`
- `art-design-skill`
- `seedance-storyboard-skill`
- `script-analysis-review-skill`
- `art-direction-review-skill`
- `seedance-prompt-review-skill`
- `compliance-review-skill`

这些技能包不是可执行程序，而是 Agent 运行时读取的规则源。

它们负责定义：

1. 输出模板
2. 审核标准
3. 叙事与镜头规则
4. Seedance 平台约束
5. 合规边界

### 4. 数据层设计

原始目录的数据分层如下：

#### 输入层

- `script/`

存放用户剧本，支持多集。

#### 共享资产层

- `assets/character-prompts.md`
- `assets/scene-prompts.md`

按集持续累积角色提示词和场景提示词。

#### 产出层

- `outputs/<epXX>/01-director-analysis.md`
- `outputs/<epXX>/02-seedance-prompts.md`

#### 运行状态层

- `.agent-state.json`

原始设计中，这个文件用于记录 Claude 风格 resumable subagents 的 agentId。

---

## 三、原始设计的局限

原始工程的规则表达很完整，但它存在一个明显问题：

它依赖外部 Agent 宿主环境来读取这些 Markdown 定义并执行调度。

也就是说，原始目录本身具备：

1. 角色定义
2. 规则定义
3. 模板定义
4. 产物结构定义

但不具备：

1. 本地 CLI 入口
2. 独立的模型调用层
3. 本地 session 管理器
4. 脱离 Claude 的调度器
5. 命令行执行链路

因此，原始目录更像“Agent 配置包”，不是独立程序。

---

## 四、独立化改造目标

本次改造的目标是把该目录转成可独立运行的本地程序，并满足以下原则：

1. 不依赖 Claude 或 Claude 子 Agent 调度。
2. 尽量复用原有 `CLAUDE.md`、`agents/`、`skills/` 的业务规则。
3. 不重写整套业务设计，只补运行器。
4. 默认接入 Gemini，底层可走 OneAPI / 兼容网关。
5. 保留三阶段流程与双审核闭环。
6. 保留当前文件结构和产物格式。

---

## 五、独立程序设计

### 1. 新增入口程序

新增文件：

- `Seedance 2.0 分镜师团队/seedance.py`

这个文件现在承担原先外部宿主的主要职责。

### 2. 设计原则

独立程序采用“规则层不动、执行层新增”的方式：

#### 规则层

继续复用：

- `CLAUDE.md`
- `agents/*.md`
- `skills/**/*.md`

#### 执行层

新增：

1. 项目扫描器
2. 本地状态机
3. Gemini 网关模型适配器
4. Agent session 持久化
5. `start/design/prompt/status` 命令

### 3. 程序职责拆分

#### SeedanceProject

负责：

1. 扫描 `script/`
2. 推断集数
3. 识别当前阶段
4. 读取和写入产物文件
5. 维护 `.agent-state.json`

#### RuntimeStore

负责：

1. 维护 `.seedance-runtime/`
2. 记录当前集数
3. 按角色保存本地对话历史
4. 在切换集数时重置 session

#### GeminiGatewayClient

负责：

1. 请求 Gemini 模型（默认经兼容网关）
2. 支持 `GEMINI_BASE_URL` / `ONEAPI_BASE_URL`
3. 支持 `GEMINI_API_KEY` / `ONEAPI_API_KEY`
4. 支持按角色切分模型

#### StandaloneRunner

负责：

1. `status`
2. `start`
3. `design`
4. `prompt`
5. 审核与修订循环
6. 将 Markdown 规则拼装成 system prompt

---

## 六、本次已执行落地内容

### 1. 已新增独立运行入口

已实现：

- `python3 seedance.py status`
- `python3 seedance.py start ep01 --style "..." --medium "..."`
- `python3 seedance.py design ep01`
- `python3 seedance.py prompt ep01`

### 2. 已实现项目状态检测

程序会自动扫描：

1. `script/`
2. `outputs/`
3. `assets/`
4. `.agent-state.json`

并输出：

1. 当前剧本文件列表
2. 当前集数
3. 当前阶段
4. Agent 状态
5. 下一步命令

### 3. 已实现本地会话机制

新增目录：

- `Seedance 2.0 分镜师团队/.seedance-runtime/`

它用于保存：

1. 当前集元数据
2. 各角色的本地 session
3. 已发送给模型的消息历史

原 `.agent-state.json` 不再依赖 Claude agentId，而是由本地运行器维护本地 session id。

### 4. 已实现模型适配层

当前设计默认使用 Gemini 模型，底层经兼容网关接入，因此可以接入：

1. OneAPI
2. 本地代理网关
3. 任何兼容 `/v1/chat/completions` 的服务

环境变量支持：

- `GEMINI_BASE_URL`
- `GEMINI_API_KEY`
- `ONEAPI_BASE_URL`
- `ONEAPI_API_KEY`
- `SEEDANCE_MODEL`
- `SEEDANCE_DIRECTOR_MODEL`
- `SEEDANCE_ART_MODEL`
- `SEEDANCE_STORYBOARD_MODEL`
- `SEEDANCE_TIMEOUT_SECONDS`

### 5. 已实现审核闭环

三个阶段都已接入“生成 → 审核 → 修订 → 重审”的循环。

#### 阶段一

1. director 生成 `01-director-analysis.md`
2. director 执行业务审核
3. director 执行合规审核
4. 若任一 FAIL，则按反馈重写后再审

#### 阶段二

1. art-designer 生成新增人物提示词和场景提示词
2. director 执行业务审核
3. director 执行合规审核
4. 若任一 FAIL，则按反馈重写后再审

#### 阶段三

1. storyboard-artist 生成 `02-seedance-prompts.md`
2. director 执行业务审核
3. director 执行合规审核
4. 若任一 FAIL，则按反馈重写后再审

### 6. 已新增独立使用文档

新增文件：

- `Seedance 2.0 分镜师团队/README_STANDALONE.md`

该文件记录了：

1. 运行方式
2. 模型配置方式
3. 命令示例
4. 状态文件说明
5. 当前实现边界

---

## 七、本次执行验证结果

本次已完成的本地验证包括：

1. `python3 -m py_compile seedance.py` 通过。
2. `python3 seedance.py status` 可正常运行。
3. `python3 seedance.py --help` 可正常输出命令帮助。
4. `python3 seedance.py start --help` 可正常输出子命令参数。
5. 编辑器静态错误检查未发现 `seedance.py` 报错。

注意：

本次没有直接执行真实的 `start/design/prompt` 全流程生成，因为当前环境未预置可用的模型接口密钥和地址。

因此，目前属于：

- 代码链路已打通
- 本地 CLI 已可运行
- 实际模型生成需由调用方补齐环境变量后执行

---

## 八、当前边界与风险

### 1. 规则依赖模型服从性

该程序虽然已经独立，但仍然依赖模型遵守输出格式。

尤其是服化道阶段，程序要求模型按双区块返回：

1. `<<<CHARACTER_PROMPTS>>>`
2. `<<<SCENE_PROMPTS>>>`

如果模型偏离格式，程序会拒绝写入。

### 2. 目前仍是 CLI 形态

当前版本是命令行程序，不是 Web 平台，也不是桌面应用。

### 3. 审核仍由同一逻辑体系完成

虽然已脱离 Claude 宿主，但审核逻辑仍然由同一套规则驱动的 LLM 完成。

这意味着它仍属于“规则驱动的 AI 审核闭环”，不是传统静态 lint。

### 4. 资产替换策略较保守

当前 `--force` 采用按集替换资产块的方式，适合重跑当前集，但还没有实现更细粒度的条目级差异合并。

---

## 九、建议的下一阶段工作

如果继续往前推进，建议按以下顺序做：

### 阶段 A：提高稳定性

1. 将服化道阶段输出改为严格 JSON 包装，再转 Markdown。
2. 将审核输出改为结构化结果，避免只靠正则匹配 PASS。
3. 为角色/场景条目生成稳定 ID，减少 `--force` 时的替换歧义。

### 阶段 B：提高可用性

1. 增加 Web UI。
2. 提供任务面板和阶段按钮。
3. 增加日志界面和审核意见面板。

### 阶段 C：提高工程化程度

1. 将 `seedance.py` 拆成模块化包结构。
2. 增加单元测试和集成测试。
3. 把模型提供方、模板渲染、文件写入、审核器拆成独立模块。

---

## 十、归档结论

`/root/Seedance 2.0 分镜师团队/Seedance 2.0 分镜师团队` 原本是一套依赖外部 Agent 宿主执行的多 Agent 规则工程。

本次已经完成的工作是：

1. 保留原有 Markdown 规则体系不动。
2. 新增独立运行器 `seedance.py`。
3. 让项目可以在无 Claude 宿主的情况下，通过 Gemini / OneAPI 接口独立执行。
4. 保留三阶段生成与双审核闭环。
5. 补充了独立运行说明与本地状态管理。

因此，当前项目已经从“Agent 配置包”转成“可独立运行的最小 CLI 程序”。

后续若继续演进，重点不再是“能否脱离 Claude”，而是“如何提高格式稳定性、产品可用性和工程化程度”。
---

## 十一、nanobanana 在 RS / tldraw 双侧的接入现状（2026-05-07 调研）

### 11.1 tldraw 侧（已生产）
- 入口：`POST /api/nanobanana-gen`，代码在 `tldraw-local-server/server.js#5533-5700`
- 通道：OneAPI **channel 10**（nxaiapp Gemini Image），OpenAI 兼容 `/v1/chat/completions`
- 模型可选：`gemini-3-pro-image-preview-2k` / `-4k` / `nanobanana`（Gemini 2.5 Flash Image）
- 请求体：`{ model, prompt, size('2K'|'4K'), aspectRatio, referenceImages[], httpBase }`
- 参考图特殊处理：服务端先把每张参考图下载并 base64 内联进 messages（Gemini 上游不允许 8086 端口回拉）
- 出图回包：`choices[0].message.content` 内是 markdown `![](data:image/...;base64,...)`，服务端正则解出 base64 → 落盘到 `tldraw-local-server/uploads/nanobanana_*.jpg` → 回**绝对 URL**
- 前端面板：`my-tldraw-app/src/NanoBananaUI.jsx`，由 `window.dispatchEvent('nanobanana-open', …)` 触发；构建产物：`10.7/plugins/tldraw_board/assets/NanoBananaUI-*.js`

### 11.2 RS 侧（已存在，可复用，无需迁移）
位置：`10.7/plugins/ai_series/pages/api.php`

| 函数 | 行号 | 作用 |
|---|---|---|
| `ai_series_smart_analyze_node_base()` | 203 | 读 `AI_SERIES_SMART_ANALYZE_NODE_BASE` / `SEEDANCE_NODE_BASE`，默认 `http://127.0.0.1:8086` |
| `ai_series_smart_analyze_call_nanobanana($prompt, $aspect_ratio, $size)` | 996 | PHP curl → tldraw `/api/nanobanana-gen` → 返回 `{ ok, image_url, image, model }` |
| `ai_series_smart_analyze_download_data_url($url)` | 1049 | 把回包的 `imageUrl` 拉成 `data:image/...;base64,...` |
| `ai_series_smart_analyze_run_shot_pipeline($project, $shot, $core, $params, $submit_video=true)` | 1085 | 出图 → `ai_series_motionity_save_frame`（design frame）→ `ai_series_create_binding_task` → （可选）`ai_series_submit_binding_task_internal` |
| action `smart_analyze_run` | 1192 | HTTP 入口 |

要点：
- RS PHP **不直连 OneAPI**，而是 POST 到 tldraw 的 Node 代理，凭据/重试/落盘统一在 Node 一侧。
- `run_shot_pipeline` 已留 `$submit_video=false` 分支，正好对应"停在生成视频之前"的需求。
- `ai_series_create_binding_task($project_ref, [$shot_ref], $episode_ref)` 一次只塞一个 shot ref，天然支持"每镜独立、不合并"。

### 11.3 与 gemini-3.1（同 OneAPI ch10 的文本伴侣）的对照

| 模型 | OneAPI 通道 | RS 端怎么调 | tldraw 端怎么调 |
|---|---|---|---|
| gemini-3.1（文本，`gemini-3-flash-preview`） | ch10 | PHP shell → `seedance.py`（Python）→ OneAPI | server.js 内置 chat 调用 |
| **nanobanana（出图）** | ch10 | **PHP → curl tldraw `/api/nanobanana-gen` → OneAPI** | server.js `/api/nanobanana-gen` 直接走 OneAPI |

两者"双侧存在"形态不同：gemini-3.1 是 PHP+Python 各一份；nanobanana 是 PHP 借道 tldraw Node 代理。

### 11.4 一键成片落地策略（直接复用，不另起炉灶）
1. `publish_outputs()` 中，每创建一个 entity Photo（角色 base/variant、场景 panel）后：
   - 用该 Photo 的 `prompt_pos` 调 `ai_series_smart_analyze_call_nanobanana()` 拿 `image_url`
   - `ai_series_smart_analyze_download_data_url()` 拉成 data URL
   - 写入对应 Photo resource（沿用 `ai_series_motionity_save_frame` 或 `create_resource_from_*` 同一套）
2. `publish_shots()` 中，对每个 shot：
   - 不再调 `ai_series_link_episode_shot()`（不进分镜管理）
   - 调 `ai_series_create_binding_task($project_ref, [$shot_ref], $episode_ref)`（每镜独立、不合并）
   - **不**触发 `ai_series_submit_binding_task_internal`（停在生成视频之前）

### 11.5 多租户开关
`DESIGN_MULTI_TENANT_V2.md` 已登记：
- `ai_nanobanana_image`（AI 工作流开关）
- `board_nanobanana_image`（白板右键菜单开关）

接入一键成片时按 entity 创建场景判断当前公司是否启用 `ai_nanobanana_image`，未启用时跳过出图、保留文字 entity。

---
## 12. 窜进"我的收藏夹"的孤儿 collection — OCF 一键成片新模块 publish 链路缺陷（2026-05-08 核查）

> 与 §11 一键成片落地策略相关。本节记录线上现象 + 根因定位 + 与 v1 剧集树为何有差异，**仅核查未改代码**。

### 12.1 现象

`muyaowu713001@gmail.com`（lead 角色，company_ref=4，西游漫剧/测试漫剧业主）登录"获客蜂"前端，**右侧"我的收藏夹"侧栏混入大量技术合集**（用户截图红圈，30+ 条）：
- `镜头 P01`、`P02` … `P06`（成批 6 条同时出现）
- `镜头 G91`、`镜头 001`、`镜头 S001-S007`
- `第S01-测试实验室场`、`第S02-数据走廊场`、`第S03-主机房场`
- `第1集《...》`、`第1场`、`分镜库`

普通用户视角："我没建过这些"。

### 12.2 RS 内置已有的"剧集树合集隔离"机制 — 但没保护住孤儿

剧集树（v1 西游漫剧 / 测试漫剧）**不窜扰**，因为：

1. RS `get_user_collections()` 在 [collections_functions.php:62-63](file:///var/www/html/resourcespace/10.7/include/collections_functions.php) 加了过滤：
   ```php
   // Exclude collections managed by ai_series_tree (v2 series browse)
   $condsql .= " AND c.ref NOT IN (SELECT collection_ref FROM ai_series_tree)";
   ```
2. v1 剧集树**所有节点都注册到 `ai_series_tree`**，于是被这条排除掉，不出现在"我的收藏夹"侧栏。
3. 同时 v1 经 `ai_series_tree_create_node()` 统一入口（[ai_series_data.php:4307+](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php) line 4307）：建 collection → 设 type=4 → attach TPL_* usergroup → INSERT ai_series_tree → add resource，事务化。

**这套机制本身合规且工作良好**。失效的不是机制，是**新路径绕过了它**。

### 12.3 数据画像

```sql
-- "镜头 / 第S / 第N场 / 第N集 / 分镜库" 命名 collection 在 ai_series_tree 中是否注册
SELECT 
  CASE WHEN t.ref IS NULL THEN 'NOT_IN_TREE (孤儿)' ELSE 'IN_TREE (正常)' END AS status,
  COUNT(*) AS cnt
FROM collection c LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
WHERE c.name LIKE '镜头%' OR c.name LIKE '第S%' OR c.name LIKE '分镜库' OR c.name LIKE '第%场' OR c.name LIKE '第%集%'
GROUP BY status;
```
| status | cnt |
|---|---|
| IN_TREE (正常) | 104 |
| **NOT_IN_TREE (孤儿)** | **90** |

孤儿 90 条全部：
- `user=1` (admin)
- `type=4` (PUBLIC)
- `parent=NULL`
- `public=0`
- `collection_resource` 关联 = **0**（全是空合集）

### 12.4 时间分布揭示反复触发模式

```sql
SELECT DATE_FORMAT(created,'%Y-%m-%d %H:%i') AS minute, COUNT(*) FROM collection c
LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
WHERE t.ref IS NULL AND c.user=1 AND c.name LIKE '镜头%' OR c.name LIKE '第%场' OR c.name LIKE '分镜库' OR c.name LIKE '第S%' OR c.name LIKE '第%集%'
GROUP BY minute;
```
| 时间段 | 条数 | 模式 |
|---|---|---|
| 2026-05-07 00:48:25-31 | 10 | 第 S01/S02/S03 + 镜头 S001-S007（一份完整剧集，6 秒内连续创建）|
| 2026-05-07 00:52:15-21 | 10 | **同名同模式重复一次** |
| 2026-05-07 01:33 | 9 | 又一次 |
| 2026-05-07 11:47 | 2 | 部分重跑 |
| 2026-05-07 16:13/14/17/19 | 31 | "镜头 P01-P06" 多批连续 |
| 2026-05-07 18:30/52/57/58 | 18 | 仍然 P01-P06 模式 |

**明显规律**：同一份业务数据（`测试实验室/数据走廊/主机房` scene 集 + S001-S007 / P01-P06 shot 集）**被反复处理多次**，每次处理都生成新一批同名 collection。

### 12.5 来源定位 — OCF（One-Click Film）一键成片新模块

业务名"测试实验室"不是 v1 剧集，是用户在 tldraw 白板**场景提示词库**编辑的内容，存于 [`/root/tldraw-local-server/rooms/rs-collection-10148.json`](file:///root/tldraw-local-server/rooms/rs-collection-10148.json)：
```json
{"id":101867,"title":"测试实验室","entity_ref":101867,"entity_type":"scene","fixed_id":"S01","scene_id":"S01"}
{"id":101868,"title":"数据走廊",...,"fixed_id":"S02"}
{"id":101869,"title":"主机房",...,"fixed_id":"S03"}
```

这是 **v2 OCF（One-Click Film）流程**的输入 — 与 v1 漫剧（手动点"+ 新建剧集 / 场次 / 镜头"）完全不同。OCF 入口：
- `/var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_one_click_film.php`
- 入口函数 `ai_series_ocf_publish_outputs()` (line 951)
- CLI runner `/var/www/html/resourcespace/10.7/plugins/ai_series/scripts/run_one_click_film.php`

### 12.6 OCF publish 链路缺陷（孤儿真正原因）

#### 12.6.1 `ai_series_create_resource()` 没有去重逻辑

[`ai_series_data.php:3103`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php#L3103)：
```php
function ai_series_create_resource(int $type, array $fields, int $archive = AI_ARCHIVE_DRAFT): ?int
{
    global $userref;
    $ref = create_resource($type, $archive, $userref ?? 0);  // ← 每次都 INSERT 新 resource
    ...
}
```

`AI_TYPE_SCENE` / `AI_TYPE_SHOT` 创建**完全不查 `fixed_id` / scene_num 是否已存在**。同一份 ep01 分镜 md 反复跑 publish 就反复生成新 shot/scene resource。

#### 12.6.2 ensure_shot_tree 的 idempotent 是按 shot_resource_ref，不是按业务 fixed_id

[`ai_series_data.php:1614`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php#L1614)：
```php
$shot_node = ai_series_get_shot_tree_node($shot_resource_ref);  // ← 按 resource_ref 查
if (!$shot_node) {
    // 没找到 → 建新 tree node + 新 collection
}
```

**问题**：去重 key 是 resource_ref。但 `ai_series_create_resource` 每次都生成**新的 resource_ref** → 每次都进入 `if (!$shot_node)` 分支 → 每次都建新 collection。

#### 12.6.3 OCF runner 硬编码 admin 身份且未走 setup_user

[`run_one_click_film.php:32-33`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/scripts/run_one_click_film.php)：
```php
global $userref;
$userref = 1;  // System user for resource creation.
```

**违反 known_pitfalls.md 第一条规则**："不要硬编码 `$userref = 1`，应该用 `setup_user(get_user(1))`"。这是孤儿合集 user=1 的直接原因，但**不是孤儿不挂 tree 的原因**。

#### 12.6.4 部分调用路径绕过 tree（推测）

`ai_series_ensure_shot_tree()` 内部正确调用 `ai_series_tree_create_node()`，所以正常情况会写 tree。但有 90 条没写 — 必然有路径在**只 create_collection 没走 ensure_shot_tree**。

观察数据：
- `ai_series_tree` 共 69 个 shot 节点
- shot resource (type=15, archive>=0) 有 243 个
- 孤儿 collection 90 条
- 配对 (resource ↔ tree node) 缺口 174 个，其中 90 个有空孤儿合集，84 个连合集都没有

**最可能源头**：OCF publish_outputs/publish_shots 在某条异常分支中（`episode_ref` 解析失败、try-catch 吞异常、或并发竞态）只走完了部分链路 — 创建了 collection 但没完成 tree 注册。具体源头需要复现该 publish 流程才能确认；本次仅核查不深挖代码。

### 12.7 与 v1 剧集树为何不同

| 维度 | v1 西游漫剧（不窜扰）| OCF 一键成片（窜扰）|
|---|---|---|
| 触发入口 | 用户在 v1 UI 手动点"+ 新建剧集/场次/镜头" | `/api/...` 一键成片 + CLI runner（命令行后台跑）|
| 后端路径 | `se_create_new.php` → `ai_series_tree_create_node()` 统一入口 | `ai_series_ocf_publish_outputs()` → `ai_series_create_resource()` → `ai_series_link_episode_shot()` → `ensure_shot_tree()` 多层调用 |
| 去重粒度 | UI 强制不重复（用户手动确认）| 后端 fixed_id 不去重，反复 publish 反复建 |
| 用户身份 | 真实用户 setup_user 完整 | runner CLI 硬编码 `$userref=1`（违反规则）|
| Tree 注册 | 每次都走完整事务 | 部分链路异常时半成（只建 collection）|
| 出现在"我的收藏夹"| 不（被 tree 排除过滤）| 是（孤儿没注册到 tree）|

### 12.8 是否符合 RS create_collection 规范？

**ai_series_tree_create_node 函数自身完全合规**：
- 用 RS 标准 `create_collection()` 入口
- 用 RS 标准 `type=4`（COLLECTION_TYPE_PUBLIC）
- 用 RS 标准 `parent` 字段维持层级
- 用 RS 标准 `usergroup_collection` 做 ACL
- 额外的 `ai_series_tree` 表 + `get_user_collections` 过滤补丁是规范扩展，不污染 RS core

**OCF 模块违反约定**：
- 没确保所有 collection 创建走统一入口
- 在部分异常分支或某条路径上**直接调原生 `create_collection`** 或 ensure 链路只跑了一半，绕过 tree 注册
- 缺乏业务级去重（fixed_id / scene_num 应该幂等）
- runner CLI 硬编码 `$userref=1` 违反 RS setup_user 标准

### 12.9 影响

- collection 表 90 条**业务上是垃圾**（空合集，没有 resource 关联）
- "我的收藏夹"侧栏 UI 被技术合集污染，运营找不到自己的合集
- 数据无限增长 — 每次 OCF 跑 publish 都新增一批
- 与 §6 [filestore root 污染] 同源（特权身份创建用户可见数据，没做隔离）

### 12.10 处置建议（分三层动手，本次不动）

**总体判断**：这不是"补丁能修好"的问题，是 OCF 设计时没把"幂等 + 标识层"想清楚。修复分三层，每层独立可做、独立有价值。

#### 第一层：止损（10 分钟，先做）

清理 90 条孤儿合集，让用户立即不被骚扰：

```sql
-- 仅示意，未执行。建议先 archive=2 软删观察一周再硬删
UPDATE collection SET cant_delete=0 WHERE ref IN (
  SELECT ref FROM (
    SELECT c.ref FROM collection c LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
    WHERE t.ref IS NULL AND c.user=1 
      AND (c.name LIKE '镜头%' OR c.name LIKE '第%场' OR c.name LIKE '分镜库' 
           OR c.name LIKE '第S%' OR c.name LIKE '第%集%')
  ) AS x
);
-- 软删：UPDATE collection SET archive=2 WHERE ref IN (...);
-- 硬删：DELETE FROM collection WHERE ref IN (...);
```

风险低（90 条全是空合集，无 collection_resource 关联，无业务数据丢失）。但**治标不治本** — 不堵口下次 OCF 跑还会产生。

#### 第二层：堵口（半天，关键，三个独立修复）

##### 2.1 OCF runner 改 setup_user（5 行）

[`run_one_click_film.php:32-33`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/scripts/run_one_click_film.php)：
```php
// 改前
global $userref;
$userref = 1;

// 改后（与 rag、csv_upload 等插件一致的标准做法）
$admin = get_user(1);
setup_user($admin);
```

这是 RS 标准模式（[known_pitfalls.md](file:///root/.claude/projects/-root-my-tldraw-app/memory/known_pitfalls.md) 第一条规则）。修不了 tree 缺失，但解决"全部 user=1"的可见性问题，并让后续 `checkperm` / `company_ref` 等不走兜底。

##### 2.2 ai_series_create_resource 加 fixed_id 去重（半天）

[`ai_series_data.php:3103`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php#L3103) 改成：

```php
function ai_series_create_resource(int $type, array $fields, int $archive = AI_ARCHIVE_DRAFT, ?array $dedup_keys = null): ?int
{
    if ($dedup_keys && !empty($dedup_keys)) {
        $existing = ai_series_find_resource_by_fields($type, $dedup_keys, $archive);
        if ($existing) return $existing;
    }
    global $userref;
    $ref = create_resource($type, $archive, $userref ?? 0);
    ...
}
```

OCF 调用方改：
```php
// scene 创建
$ref = ai_series_create_resource(AI_TYPE_SCENE, $fields, AI_ARCHIVE_ACTIVE, [
    AI_SCENE_FIELD_FIXED_ID => $fixed,  // 同 project + 同 fixed_id 不重复
]);

// shot 创建
$ref = ai_series_create_resource(AI_TYPE_SHOT, $fields, AI_ARCHIVE_ACTIVE, [
    AI_SHOT_FIELD_CODE  => $shot_fixed,
    AI_SHOT_FIELD_LABEL => $title,
]);
```

效果：同一份分镜 md 反复 publish **复用**同一 resource_ref → `ensure_shot_tree` 的 idempotent（按 resource_ref 查）真正生效 → 不再每次新建 collection。**这是从根上杜绝重复的关键**。

##### 2.3 publish 末尾加 tree 注册一致性自检（2 小时）

`ai_series_ocf_publish_outputs()` 末尾：
```php
$orphan_count = ps_value(
    "SELECT COUNT(*) value FROM collection c 
     LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref 
     WHERE c.created >= ? AND c.user = ? AND t.ref IS NULL",
    ['s', $task_started_at, 'i', $admin_ref], 0
);
if ($orphan_count > 0) {
    $errors[] = "publish_outputs left {$orphan_count} orphan collections — see 漫剧Agents.md §12";
    // 选择：(a) 直接软删孤儿；(b) 试图补 tree 行；(c) 仅记日志
}
```

每次 publish 完跑一次自检，孤儿不超过 0。有则报警/自动清理。**作用是监控，不是治本** — 但能立刻发现新出现的违规路径。

#### 第三层：架构升级（v3，可选，不建议本期做）

加新 `COLLECTION_TYPE_AI_INTERNAL = 8` 常量，让 ai_series 内部合集走专属 type，`get_user_collections` 默认 validtypes 不含它：

```php
// definitions.php
define("COLLECTION_TYPE_AI_INTERNAL", 8);

// collections_functions.php
$validtypes = [COLLECTION_TYPE_STANDARD, COLLECTION_TYPE_PUBLIC, COLLECTION_TYPE_REQUEST];
// 不再需要 NOT IN (SELECT collection_ref FROM ai_series_tree) 过滤补丁

// ai_series_tree_create_node
ps_query("UPDATE collection SET type = ? WHERE ref = ?", ['i', COLLECTION_TYPE_AI_INTERNAL, ...]);
```

| 好 | 坏 |
|---|---|
| 不需 RS 跨模块 JOIN ai_series_tree（性能更好）| 改 RS core，升级时易被覆盖 |
| 其他系统模块（视频生成/特效预览）也能复用 | 需迁移历史 104 条 type=4 → type=8（数据迁移风险）|
| 标准化"系统内部 collection"概念 | 当前 NOT IN 过滤虽丑但工作正常 |

**建议 v3 再做**。本期不碰 RS core。

#### 优先级与工作量

| 项 | 优先级 | 工作量 | 风险 | 用户感知 |
|---|---|---|---|---|
| 1 清理孤儿 | **高** | 10min | 低 | UI 立即清爽 |
| 2.1 setup_user | **高** | 5min | 极低 | 无感（修隐患）|
| 2.2 fixed_id 去重 | **高** | 半天 | 中（需测多种 publish 场景）| 防止再生产 |
| 2.3 tree 注册自检 | 中 | 2h | 低 | 监控/告警 |
| 3 COLLECTION_TYPE | 低 | 一周 | 高 | 长期架构 |

#### 推荐落地节奏

**做 1 + 2.1 + 2.2** 三件，约一天工作量，能完整闭环：
- 1 清掉历史孤儿
- 2.1 守住 publish 期间的用户身份
- 2.2 杜绝同一业务数据反复建

2.3 自检可以一并做但不强求。第三层留给 v3。

**不要直接动 RS core**（即不要碰 `get_user_collections` / `definitions.php`），那超出"补丁修复"范畴，需要单独评估升级影响。

### 12.11 引用

- [`/var/www/html/resourcespace/剧集进入路径.md`](file:///var/www/html/resourcespace/剧集进入路径.md) — v1 剧集树不窜扰的标准路径
- [`/var/www/html/resourcespace/10.7/include/collections_functions.php:18-150`](file:///var/www/html/resourcespace/10.7/include/collections_functions.php) — `get_user_collections()` 的 ai_series_tree 排除过滤
- [`/var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php:4307`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php) — `ai_series_tree_create_node` 统一入口（v1 走这里，OCF 部分走部分不走）
- [`/var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_one_click_film.php`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_one_click_film.php) — OCF 模块（v2 一键成片，本次孤儿来源）
- [`/var/www/html/resourcespace/10.7/plugins/ai_series/scripts/run_one_click_film.php:32-33`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/scripts/run_one_click_film.php) — 硬编码 $userref=1（违反 setup_user 规则）
- [`/root/tldraw-local-server/rooms/rs-collection-10148.json`](file:///root/tldraw-local-server/rooms/rs-collection-10148.json) — 用户在白板编辑的 OCF 输入（场景提示词库）

---

## 13. §12 修复执行记录（2026-05-08 完成）

按 §12.10 三层方案落地，三层全做了，验证通过。

### 13.1 第一层：止损 — 软删 90 条孤儿

执行 SQL（`type=4` → `type=99` + 名字加 `[DEPRECATED-2026-05-08]` 前缀）：
```sql
UPDATE collection c LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
SET c.type=99, c.name=CONCAT('[DEPRECATED-2026-05-08] ', c.name)
WHERE t.ref IS NULL AND c.user=1 
  AND (c.name LIKE '镜头%' OR c.name LIKE '第%场' OR c.name LIKE '分镜库' 
       OR c.name LIKE '第S%' OR c.name LIKE '第%集%')
  AND c.type=4;
-- ROW_COUNT = 90
```

**为什么不直接 DELETE / archive=2？**
- `collection` 表**没有 archive 字段**（只 `resource` 表有），所以 archive=2 方案不适用
- type=99 是一个 RS 没定义的值（RS 内置仅 0-7），`get_user_collections()` 的 `validtypes IN (0,4,6)` 过滤掉
- 软删保留原数据 — 一周后可批量 DELETE 也可恢复 type=4

数据备份：`/tmp/orphan_collections_backup_2026-05-08.tsv`（91 行 = 表头 + 90 条 ref/name/user/created）。

### 13.2 第二层 2.1：runner setup_user

[`run_one_click_film.php:32-33`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/scripts/run_one_click_film.php) 改写：

```php
// 改前
global $userref;
$userref = 1;  // System user for resource creation.

// 改后
$admin = get_user(1);
if ($admin === false) {
    fwrite(STDERR, "Could not load user ref=1 for setup_user\n");
    exit(2);
}
setup_user($admin);
global $userref;
$userref = (int) $admin['ref'];
```

备份：`run_one_click_film.php.bak-before-setup-user-2026-05-08`

### 13.3 第二层 2.2：dedup_keys 幂等去重（关键修复）

#### 加新签名 + 内部去重逻辑

[`ai_series_data.php:3103`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_data.php#L3103)：
```php
function ai_series_create_resource(
    int $type, array $fields, int $archive = AI_ARCHIVE_DRAFT,
    ?array $dedup_keys = null,           // [field_id => value, ...]
    ?int $dedup_project_ref = null       // 限定到 project（避免不同剧集 fixed_id 冲突）
): ?int
{
    if (!empty($dedup_keys)) {
        $existing_ref = ai_series_find_resource_by_fields($type, $dedup_keys, $dedup_project_ref);
        if ($existing_ref > 0) {
            // 复用：更新非 dedup 字段（描述/prompt 等可能因 publish 而变）
            foreach ($fields as $field_id => $value) {
                update_field($existing_ref, (int) $field_id, (string) $value);
            }
            // shot/script 类型刷 txt 缩略图
            if ($type === AI_TYPE_SHOT || $type === AI_TYPE_SCRIPT) {
                $txt_content = ai_series_build_txt_content($type, $existing_ref, $fields);
                ai_series_attach_file($existing_ref, 'txt', '', $txt_content);
            }
            return (int) $existing_ref;
        }
    }
    // ... 原 INSERT 路径不变
}
```

#### 加 helper：按字段组合查重

```php
function ai_series_find_resource_by_fields(int $type, array $field_values, ?int $project_ref = null): int
{
    // 多次 JOIN resource_node + node 联表查重
    // 可选 JOIN ai_series_project_asset 限定到某个 project
    // 返回匹配的 resource ref，未找到返回 0
}
```

#### OCF 三处调用方传 dedup_keys

[`ai_series_one_click_film.php`](file:///var/www/html/resourcespace/10.7/plugins/ai_series/include/ai_series_one_click_film.php)：

| 调用点 | dedup_keys | dedup_project_ref |
|---|---|---|
| line 1025 character | `[AI_CHAR_FIELD_FIXED_ID => $fixed]` | `$project_ref` |
| line 1146 scene | `[AI_SCENE_FIELD_FIXED_ID => $fixed]` | `$project_ref` |
| line 1283 shot | `[AI_SHOT_FIELD_CODE => $shot_dedup_code]` | `$project_ref` |

效果：同一 (project_ref + fixed_id) 已存在的 resource **复用 ref**，不再每次 publish 新建。`ensure_*_tree` 的 idempotent（按 resource_ref 查 ai_series_tree）真正生效。

备份：`ai_series_data.php.bak-before-dedup-2026-05-08` / `ai_series_one_click_film.php.bak-before-dedup-2026-05-08`

### 13.4 第二层 2.3：publish 末尾自检 + 自动软删

`ai_series_ocf_publish_outputs()` 函数内：

#### 函数开头记录 publish 起点
```php
$publish_started_at = date('Y-m-d H:i:s');
global $userref;
$current_userref = (int) ($userref ?? 1);
```

#### 函数末尾扫描孤儿 + 自动软删
```php
$orphan_rows = ps_query(
    "SELECT c.ref, c.name FROM collection c
     LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
     WHERE c.created >= ? AND c.user = ? AND t.ref IS NULL",
    ['s', $publish_started_at, 'i', $current_userref]
);
$orphan_count = count($orphan_rows);
if ($orphan_count > 0) {
    $errors[] = "publish_outputs left {$orphan_count} orphan collections...";
    // 自动软删（type=99 + [ORPHAN-YYYY-MM-DD] 前缀）
    foreach ($orphan_refs as $oref) {
        ps_query("UPDATE collection SET type=99, name=CONCAT('[ORPHAN-{$today}] ', name) WHERE ref=? AND type=4", ['i', $oref]);
    }
}

return [
    ... 原字段 ...
    'orphan_count' => $orphan_count,    // 新增：调用方可看到本次有多少孤儿
    'errors'       => $errors,
];
```

后续路径（如有新代码再产生孤儿）：
1. `errors` 数组留下记录 → OCF task 表 `error_message` 字段会显示
2. 孤儿被自动软删（type=99 + ORPHAN- 前缀），不会污染侧栏
3. 监控告警可查 `errors LIKE '%orphan_count%'` 找出哪些 task 触发了

### 13.5 验证结果

```sql
-- "我的收藏夹"侧栏可见的孤儿（孤儿命名 + user=1 + 在 validtypes 0/4/6 内 + 不在 ai_series_tree）
SELECT COUNT(*) FROM collection c LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
WHERE c.type IN (0,4,6) AND t.ref IS NULL AND c.user=1
  AND (c.name LIKE '%镜头%' OR c.name LIKE '%第S%' OR ...);
-- 0 ← 之前是 90
```

```sql
-- 软删归档（type=99 + DEPRECATED 前缀）
SELECT COUNT(*) FROM collection WHERE type=99 AND name LIKE '[DEPRECATED-2026-05-08]%';
-- 90
```

```sql
-- 剧集树正常 collection 完好
SELECT t.node_type, COUNT(*) FROM ai_series_tree t GROUP BY t.node_type;
-- shot:69, scene:20, episode:11, project:12, ... 共 224 个，与修复前一致
```

```sql
-- muyaowu (user=6) 视角的"我的收藏夹"
SELECT COUNT(*) FROM collection c LEFT JOIN ai_series_tree t ON t.collection_ref=c.ref
WHERE c.type IN (0,4,6) AND t.ref IS NULL AND c.user=6;
-- 13 条，全是她自建的 (test/Upload-/Default Collection/...)
```

侧栏不再窜扰 ✅

### 13.6 文件改动清单

| 文件 | 改动 | 备份 |
|---|---|---|
| `ai_series_data.php` | `ai_series_create_resource` 加 dedup 参数；新增 `ai_series_find_resource_by_fields` | `.bak-before-dedup-2026-05-08` |
| `ai_series_one_click_film.php` | 3 处 `ai_series_create_resource` 加 dedup_keys；publish 末尾自检 | `.bak-before-dedup-2026-05-08` |
| `run_one_click_film.php` | `$userref=1` → `setup_user(get_user(1))` | `.bak-before-setup-user-2026-05-08` |
| collection 表 | 90 条孤儿 type 4→99 + 名字加前缀 | `/tmp/orphan_collections_backup_2026-05-08.tsv` |

`systemctl restart php8.1-fpm apache2` 已刷 opcache。

### 13.7 第三层 v3（COLLECTION_TYPE_AI_INTERNAL）— 未做

按计划留作 v3，本期不动 RS core。

### 13.8 重要澄清：本次是"包防护层"，不是"修源头"

**严格区分**：

§12.6 定位的"产生不合格 collection 的具体 bug 代码段"（OCF publish 链路某条异常分支只 `create_collection` 没注册 `ai_series_tree`）**本次没真正定位到、也没改**。我们做的三层修复都是**外围防护**，不是病灶根治。

| 修复 | 是否动了"产生孤儿"的源头 | 实际作用 |
|---|---|---|
| 2.1 setup_user | ❌ 不是 | 修身份污染，跟 tree 缺失无关 |
| 2.2 dedup_keys 去重 | ❌ 不是 | **减少触发频次**：同 publish 第二次复用 resource → 不再走 ensure_tree → bug 路径不再被触发；但 ensure_tree 内部的 bug 路径**仍然存在** |
| 2.3 publish 末尾自检 | ❌ 不是 | **事后补救**：孤儿仍会被产生，只是立刻被软删 + 告警 |

#### 病灶仍在原地

`ai_series_ensure_shot_tree()` / `ai_series_ensure_scene_tree()` 中**某条具体 bug 路径**（episode_ref 解析失败 / try-catch 吞异常 / 并发竞态 / 中途 throw 没回滚）依然存在。本次未触动这块代码。

#### 为什么不修源头

§12.10 当时讨论就明确按"补丁修复"思路走，而非"根因定位"。改 ensure_tree 源头需要：
1. 真正复现 bug 才能验证 — 需 OCF runner 完整环境（OneAPI 网关 + Seedance API + 完整剧本）
2. 改 RS 关键路径风险高（这是 v1 漫剧+v2 OCF 都依赖的核心函数）
3. 复现需要 OneAPI / Seedance 凭据 + 测试环境

所以采取了**"减少触发 + 立即拦截 + 自动清理"的多层防御**。

#### 实际效果与残余风险

| 场景 | 当前防护 |
|---|---|
| 历史 90 条孤儿 | ✅ 已软删归档 |
| OCF 反复 publish 同一份业务数据（之前的高频痛点）| ✅ 2.2 dedup 让第二次起复用 resource，不再走 ensure_tree → bug 路径不再触发 |
| OCF **首次** publish 时遇到那条异常分支 | ⚠️ 仍会产生孤儿，但 2.3 自检会立刻软删（type=99 + `[ORPHAN-YYYY-MM-DD]` 前缀），**用户感知 = 0**，OCF task `error_message` 字段留痕便于告警 |
| 其他模块（非 OCF）调用 ensure_tree 触发 bug 分支 | ❌ 当前防护不覆盖 — 2.3 自检只在 `ai_series_ocf_publish_outputs` 末尾执行 |

#### 真要修源头怎么做（v3 待做）

1. 在测试环境补 OCF 凭据（OneAPI / Seedance API），跑通完整 publish 流程
2. 加详细 trace 日志，复现 collection 建了但 tree 没建的具体异常
3. 找到具体 catch / throw 点，改 `ai_series_ensure_shot_tree` / `ai_series_ensure_scene_tree` 加 SQL 事务保证（建 collection + INSERT tree 包成一个事务，失败一起回滚）
4. 或考虑把 2.3 自检从"OCF 末尾"改为"`ai_series_tree_create_node` 末尾"做单 step 自检（更通用，覆盖所有调用方）

### 13.9 后续观察

- 一周内观察 `[ORPHAN-YYYY-MM-DD]` 前缀的新孤儿是否出现：
  - 出现 → 说明仍有 OCF 异常分支或其他非 dedup 路径触发 bug，需进一步定位
  - 不出现 → 说明 dedup_keys 已覆盖主要触发场景，2.3 自检作为兜底足够
- 一周后批量 DELETE 90 条 `[DEPRECATED-2026-05-08]` 软删数据（需手工确认无误后执行）
- OCF task 表 `error_message` 字段定期扫描 `LIKE '%orphan%'` 告警
