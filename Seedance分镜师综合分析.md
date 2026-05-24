# Seedance 分镜师团队 · 综合分析

> 归档日期:2026-05-06
> 范围:多轮讨论汇总——产物衔接、CrewAI/pipeline 接入、`seedance.py` 代码结构、审核机制、文生图拆分、@引用规范
> 关联代码:[`/root/Seedance 2.0 分镜师团队/Seedance 2.0 分镜师团队/`](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队)
> 关联文档:[漫剧Agents.md](/root/Seedance%202.0%20分镜师团队/漫剧Agents.md) · [AI漫剧.md](/var/www/html/resourcespace/AI漫剧.md) · [导航_剧集.md](/var/www/html/resourcespace/导航_剧集.md) · [AI漫剧控制台进入路径.md](/var/www/html/resourcespace/AI漫剧控制台进入路径.md) · [剧集进入路径.md](/var/www/html/resourcespace/剧集进入路径.md)

---

## 一、Seedance 团队的产物 vs AI漫剧合集体系

### 1.1 对象一一对应表

| Seedance 产物 | 文件 | AI漫剧目标容器 | RS 类型 |
|---|---|---|---|
| 用户剧本 | `script/*.md` | 项目→剧本库合集 | Type 16 Script |
| 导演讲戏本 | `outputs/<ep>/01-director-analysis.md` | 第N集合集附件 / 剧本库 | Type 16 Script(或附件) |
| 角色提示词 | `assets/character-prompts.md`(累积) | 资产库→人物库合集(每条一卡) | Type 17 Character |
| 场景提示词 | `assets/scene-prompts.md`(累积) | 资产库→场景库合集(每条一卡) | Type 18 Scene |
| Seedance 动态提示词 | `outputs/<ep>/02-seedance-prompts.md` | 第N集→分镜库→镜头合集 | Type 15 Shot 的 prompt 字段 |
| `.agent-state.json` 运行态 | `.seedance-runtime/` | (不入 RS,流程态) | 对应 `ai_series_binding_task` 概念 |

### 1.2 当前未自动衔接

[`漫剧Agents.md` 七](/root/Seedance%202.0%20分镜师团队/漫剧Agents.md) 明确"实际模型生成需由调用方补齐",目前:

1. 产物只写本地文件,不调 RS API
2. 没有 `project_ref` / `episode_ref` 概念,不知道写到哪个 RS 项目
3. 角色/场景是 Markdown 段落,不是 RS resource,没有 ref 给下游绑定
4. 镜头提示词没有派生 `resource(type=15)` + 加入镜头合集 + `resource_related` 绑定人物/场景

### 1.3 最小衔接方案(对齐 AI漫剧三条强制规则)

按 [AI漫剧.md §5 主流程](/var/www/html/resourcespace/AI漫剧.md) + [导航_剧集.md §3 唯一有效入口](/var/www/html/resourcespace/导航_剧集.md),只需在 `seedance.py` 三阶段尾部各加一个 publisher 步骤,全部走 `/plugins/ai_series/pages/api.php`:

| 阶段 | Seedance 输出后追加 | 调用 |
|---|---|---|
| 阶段一 完成 | 把剧本 + 讲戏本上传成 Script | `create_resource(type=16)` → `add_resource_to_collection(script_library_ref)` |
| 阶段二 完成 | 解析 `assets/character-prompts.md` 每个条目 → 创建人物资源;同理场景 | 已有 `screen=assets` 后端;新增 `action=create_character / create_scene`(或复用 `create_lora` 范式) |
| 阶段三 完成 | 解析 `02-seedance-prompts.md` 每段 → 派生 Shot 资源 + 镜头合集 + scene_num + 用 `resource_related` 关联同名人物/场景 | 复用 `ai_series_create_episode` + `ai_series_ensure_episode_tree` + `ai_series_save_binding` |

落地后符合一致性([§7](/var/www/html/resourcespace/AI漫剧.md)):AI漫控台「分镜管理」、剧集树「第N集」、RS 镜头合集页三处看到的镜头集合完全一致。

### 1.4 与「任务式绑定」的关系

[导航_剧集.md §11–12 任务式绑定](/var/www/html/resourcespace/导航_剧集.md) 现在的 `ai_series_binding_task` 是**人工**编排提示词。Seedance 团队产出的就是同种东西——可以视为"AI 自动生成的 binding_task 草稿":

- Seedance 阶段三完成后,直接写一条 `ai_series_binding_task(status='draft', shot_refs_csv=新建的镜头refs, prompt_text=02-seedance-prompts.md 内容)`
- 用户在「识别绑定」页打开就能看到、可调可提交,跨屏状态机一并接管

### 1.5 不要绕过的边界

- 不要直接写 `resource` / `collection_resource` 表(违反"插件流程,不替代 RS 原生"原则)
- 角色/场景必须**先入对应库合集**,Seedance 镜头提示词里的 `[角色名]` token 才能在「智能推荐」里被命中([§11.7](/var/www/html/resourcespace/导航_剧集.md))
- 必须带 `project_ref`,否则跨公司隔离失效([§17 节点泄露教训](/var/www/html/resourcespace/导航_剧集.md))

**一句话**:产物结构已经天然对齐,只缺一个"publisher"把 Markdown 翻译成 `api.php` 调用,然后 Seedance 就成了 AI漫剧的上游"自动分镜流水线",和现有人工流程共用同一套合集 + 任务表。

---

## 二、Agents-AIWorker:Pipeline 与 CrewAI 速读

### 2.1 是什么

多领域 AI 自媒体运营平台,**核心编排框架 = CrewAI 1.14 + crewai-flows**;FastAPI 暴露 API,Postgres + Neo4j + Redis + Pinecone 撑数据;通过 YAML `DomainProfile` 实现"一份代码、N 个领域"。

### 2.2 CrewAI 在这里怎么用

1. **Agent 定义**(`src/agents/`):`factory.py` 按 `DomainProfile` 动态构建 `crewai.Agent`(role / goal / backstory / tools / llm),分两类:
   - **领域特化** Agent 5(分诊)、1(撰写)、2(核查 ★可选)、3(图谱 ★可选)
   - **通用** Agent 4(运营)、6(分析)、7(媒体主管)、8(意图分类/pipeline planner)

2. **Crew + Task 模式**(`response_flow.py:_run_agent_task`):
   ```python
   task = Task(description=..., expected_output=..., agent=agent)
   Crew(agents=[agent], tasks=[task]).kickoff()
   ```
   不用 hierarchical Crew,而是**单 agent + 单 task** 当函数调,串成 Flow。

3. **Flow 编排**(`crewai.flow.flow`)— `@start()` / `@listen(prev)` 链式,状态写 `self.state`(1.14 起 `kickoff(inputs=...)` 自动合并,**没有** `self.inputs`)。

4. **本质**(项目自己总结,见 `E2EAgent...md` L1866):"CrewAI 是 prompt 拼接,没有独立语义理解层;NLU/意图分类全靠 LLM。"

### 2.3 5 个 Flow

| Flow | 文件 | 入口 | 用途 |
|---|---|---|---|
| `DomainAwareResponseFlow` | response_flow.py | `/consult` | 分诊→(核查)→撰写→回复 |
| `DailyTaskFlow` | daily_task_flow.py | 调度器 | 日常任务编排 |
| `FeedbackMonitorFlow` | feedback_flow.py | 调度器 | 收集执行反馈/熔断 |
| `GrowthFlow` | growth_flow.py | 调度器 | 渐进放量(账号生命周期) |
| **`PipelinePlannerFlow`** | **pipeline_flow.py** | `/pipeline` 命令 / Chat UI | **自然语言 → pipeline JSON** |

### 2.4 Pipeline 子系统

**作用**:把"在抖音发布视频"这种自然语言,翻译成 `bp-server` 能执行的结构化 pipeline JSON,执行链是:

```
用户文本 ──▶ Agent 8 (pipeline_planner)
              │
              ├─ ① _match_preset()  关键词 + 渠道打分
              │     命中 → _instantiate_preset()  填变量
              │
              └─ ② 未命中 → LLM 生成 pipeline JSON
                            (拉 bp-server /api/capabilities 当上下文)
                            ↓
                       _fix_bare_item_refs / _ensure_extract_var 等后处理
                            ↓
                       pipeline JSON ──▶ bp-server PipelineExecutor
                                         (executor: bp-client / tldraw-service)
```

#### 2.4.1 Preset 模板库(`src/flows/pipeline_presets/*.json`)

17 个开箱即用模板,覆盖:发布视频、批量内容生产、合集动画化、URL 转视频、合集动画(`collection_dh_anim_v1`)、舆情监控、用户画像、周报等。每个 preset:

```json
{
  "id": "url_to_video_with_article_v1",
  "match_keywords": [...],     // 关键词命中得分
  "match_min_score": 3,        // 阈值
  "channel_template_map": {...}, // 渠道→bp-server 模板名
  "vars_schema": {...},        // 用户必填/可选变量
  "pipeline": { "steps":[...], "output":{...} }  // 真正的 pipeline JSON
}
```

#### 2.4.2 Pipeline JSON 结构

```json
{
  "version": "1.0",
  "type": "pipeline",
  "steps": [
    {
      "step_id": "...",
      "executor": "bp-client" | "tldraw-service",
      "template": "...",         // bp-client 用 template
      "service":  "...",         // tldraw-service 用 service
      "params":   {...},         // 含 {{变量}} 占位 + $step.field 引用
      "depends_on": "prev_id",
      "for_each":  "$prev.list", // 循环
      "extract_var": "..." ,     // 给后续步骤暴露变量名
      "output_key": "...",
      "timeout_ms": 120000
    }
  ],
  "output": { "target": "rs_collection", "collection_id": ... }
}
```

#### 2.4.3 关键运行时机制

- **变量占位**:`{{collectionId}}` / `{{channel}}` / `{{_resolved_template}}`(渠道映射后产物)/ `{{_resolved_upload_url}}`
- **跨步引用**:`$fetch_article.article.content` / `$item.video_url`(循环项)
- **能力发现**:`/api/capabilities` 拉 bp-server 注册的 templates + services + commands 给 LLM 当上下文
- **修复器**:`_fix_bare_item_refs` 兜底纠正 LLM 生成的 `$item` / `$item.url` 错字段
- **公司隔离**:`_load_custom_tools(company_ref)` 从 RS `agent_config` 拉公司私有工具

### 2.5 系统分层

| 系统 | 角色 |
|---|---|
| **Agents-AIWorker** | 决策层(LLM + CrewAI 编排,产 pipeline JSON) |
| **bp-server / AIworker3** | 执行层(浏览器自动化,执行 pipeline 每个 step) |
| **ResourceSpace (AI漫剧)** | 资产层 + 任务中枢(任务字段 109 schedule、execution_results 反馈) |
| **n8n** | 渠道接入 + 领域路由 |

Seedance 是**单线 CLI + 三阶段顺序生成**,Agents-AIWorker 是**多 Agent 并行 + Flow + LLM 编排 pipeline → 远程执行**。如果想把 Seedance 接到生产线,正确姿势是把它包成 Agents-AIWorker 里 **Agent 8 可调用的一个 service/template**(bp-server 或 tldraw-service 都可),让 PipelinePlannerFlow 在用户说"做漫剧分镜"时把它编进 pipeline。

---

## 三、Claude skill 那套能否用 pipeline 跑

### 3.1 短答

**可以,但需要做"包装",不是直接跑**

Seedance 的 `skills/` + `agents/` 是 **Markdown 规则包**(给 LLM 当 system prompt 读),不是可执行单元;Agents-AIWorker 的 pipeline 跑的是 **executor + template/service** 的 JSON step。两者粒度对不上,需要一层桥。

### 3.2 三种接入姿势

#### 姿势 A:整体当成一个 service(最快,推荐先做)

把 `seedance.py` 的 CLI 包成 bp-server 的一个 `service`(或 tldraw-service),例如 `seedance_storyboard_v1`,接收 `{script, ep, style, medium}`,内部跑完三阶段闭环,返回产物路径。

然后在 `src/flows/pipeline_presets/` 加一个 preset:

```json
{
  "id": "seedance_storyboard_v1",
  "match_keywords": ["分镜","漫剧","seedance","讲戏"],
  "match_min_score": 2,
  "pipeline": {
    "steps": [
      { "step_id":"gen", "executor":"tldraw-service",
        "service":"seedance_storyboard_v1",
        "params":{ "script":"{{scriptText}}", "ep":"{{ep}}" },
        "output_key":"artifacts" },
      { "step_id":"publish", "executor":"tldraw-service",
        "service":"ai_series_publish",
        "depends_on":"gen",
        "params":{ "project_ref":"{{projectRef}}",
                   "characters":"$gen.artifacts.characters",
                   "scenes":"$gen.artifacts.scenes",
                   "shots":"$gen.artifacts.shots" } }
    ]
  }
}
```

跑通后,用户在 Chat 说"给项目 7 第 1 集做 Seedance 分镜",PipelinePlannerFlow 命中 preset,直接编排执行,产物入 [AI漫剧](/var/www/html/resourcespace/AI漫剧.md) 合集。

**保留**:`CLAUDE.md` / `agents/*.md` / `skills/**/*.md` 全部规则不动,`seedance.py` 已经是它们的本地 runner。

#### 姿势 B:三阶段拆成三个 step(中等改造,可观测性好)

```
step1 director_analyze   → 出讲戏本
step2 art_design         → 出 character / scene prompts
step3 storyboard_compose → 出 seedance prompts
step4 ai_series_publish  → 入 RS 合集
```

每个 step 独立 service,Flow 可在 step 间插审核/人工 gate;失败重跑只重该 step。代价:要把 `seedance.py` 里阶段函数拆成 4 个独立 HTTP endpoint。

#### 姿势 C:把每个 Agent 重写成 CrewAI Agent(最重,不建议)

照 `src/agents/factory.py` 范式把 director / art-designer / storyboard-artist 全改成 `crewai.Agent`,skills 内容塞 backstory + tool。等于**两次开发**,丢掉 Seedance 现有代码,且 CrewAI 的 `Crew(agents,tasks).kickoff()` 不天然适合 Seedance 的"生成→双审核→修订"循环(要自己用 Flow 拼)。

### 3.3 关键障碍清单(姿势 A/B 都要解决)

| 项 | 现状 | 桥接 |
|---|---|---|
| 模型调用 | Seedance 改为 Gemini 优先(`GEMINI_BASE_URL`,默认 `gemini-3-flash-preview`) | 复用 Agents-AIWorker 的 OneAPI proxy(同 channel,见 `pipeline_agent.py:140`)|
| 产物落地 | 写 `outputs/<ep>/*.md` | 加 publisher step 调 [`/plugins/ai_series/pages/api.php`](/var/www/html/resourcespace/AI漫剧控制台进入路径.md) → 进项目合集 |
| Project 上下文 | Seedance 不知道 RS project_ref | preset 必填变量 `{{projectRef}}` + `{{episodeRef}}` |
| 审核循环 | 在 `seedance.py` 内部跑完 | 要么内部跑(姿势 A),要么 PipelinePlannerFlow 编排(姿势 B) |
| company 隔离 | 无 | publisher step 必须带 `company_ref`(对齐 [§17 节点泄露教训](/var/www/html/resourcespace/导航_剧集.md)) |

### 3.4 一句话

Seedance 的**规则层**(skills/agents Markdown)在 pipeline 体系里**继续作为 LLM system prompt 用**,无须迁移;**执行层**(`seedance.py`)注册成一个 bp-server service + 一个 preset,就能被 PipelinePlannerFlow 调起来,产物再用 publisher step 推进 [AI漫剧](/var/www/html/resourcespace/AI漫剧.md) 合集体系。**姿势 A 最小改动,先跑通再考虑拆细。**

---

## 四、`seedance.py` 代码结构(1113 行单文件 CLI)

### 4.1 顶层布局

```
模块常量
├── EPISODE_PATTERN          (识别 ep\d{2})
├── BUSINESS_PASS_PATTERN    (匹配 "业务审核：PASS")
├── COMPLIANCE_PASS_PATTERN  (匹配 "合规审核：PASS")
├── SECTION_PATTERN          (拆 <<<CHARACTER_PROMPTS>>> / <<<SCENE_PROMPTS>>>)
└── AGENT_FILE_MAP           (角色名 → agents/*.md 路径)

数据类(@dataclass)
├── EpisodeStatus            (一集的 5 个事实位 + state_label / current_stage)
├── ReviewResult             (审核名/PASS?/审核全文)
├── AgentSession             (agent_name / episode / session_id / messages[])
└── LLMConfig                (api_key / base_url / default_model / timeout)

核心类(4 个)
├── SeedanceProject          (项目文件系统视图)
├── RuntimeStore             (本地会话 / 元数据持久化)
├── GeminiGatewayClient      (HTTP /v1/chat/completions)
└── StandaloneRunner         (业务编排:三阶段 + 双审核循环)

模块函数
├── choose_current_episode / format_agent_state / next_action
├── print_status
├── build_parser             (argparse 子命令: status/start/design/prompt)
└── main                     (装配 + 派发)
```

### 4.2 `SeedanceProject`(L77–197)— 文件系统适配器

只管"项目目录里有什么、写哪儿":
- `script_dir / assets_dir / outputs_dir / agent_state_path / runtime_dir`
- `list_script_files()` 扫 `script/*.md|*.txt`
- `extract_episode(path)` 用正则从文件名提集号
- `get_episode_statuses()` 聚合每集 5 个事实位 → `EpisodeStatus` 列表
- `resolve_episode(arg)` 显式参数 / 单集兜底 / 推断"当前进行中的那一集"
- `*_for(episode)` 一组路径生成器(director / prompt / character / scene)
- `read_agent_state` / `write_agent_state` 兼容老 `.agent-state.json`

**特点**:零业务逻辑,纯 IO 视图。

### 4.3 `RuntimeStore`(L226–303)— 本地 session 管理

新设计的 `.seedance-runtime/`,替代 Claude agentId:
- `meta.json` 记 `current_episode`
- 每个 agent×episode 一份 `<agent>__<episode>.json`,存 `session_id` + `messages[]`
- `ensure_episode(ep)` 切集时**清空所有 agent 的本地 session**(防上下文串集)
- `load_session / save_session` 读写

### 4.4 `LLMConfig` + `GeminiGatewayClient`(L306–376)— 模型适配层

- `LLMConfig.from_env()` 优先 `GEMINI_*`,兜底 `ONEAPI_*`,默认模型 `gemini-3-flash-preview`
- `chat_completions_url` 自动补 `/chat/completions`
- `GeminiGatewayClient.chat()` 用 `urllib.request`(零依赖)发 POST,返回 `choices[0].message.content`

### 4.5 `StandaloneRunner`(L378–1003)— 主编排器,占代码 60%

#### 4.5.1 三个公开命令入口

| 方法 | 阶段 | 输入 | 输出 |
|---|---|---|---|
| `run_start` | 阶段一 导演分析 | `script/<ep>.md` + style/medium | `outputs/<ep>/01-director-analysis.md` |
| `run_design` | 阶段二 服化道 | director 输出 | 累积写入 `assets/character-prompts.md` + `assets/scene-prompts.md` |
| `run_prompt` | 阶段三 分镜提示词 | director + assets | `outputs/<ep>/02-seedance-prompts.md` |

每个入口的固定 4 步骨架:
```
1. resolve_episode + ensure_episode (重置 runtime)
2. 前置检查(必需文件存在 / --force 才能覆盖)
3. _generate_*  → 调 LLM 生成草稿,先写盘
4. _review_and_revise_* → 双审核循环,最终写盘 + 打印 PASS/FAIL
```

#### 4.5.2 双审核循环(每阶段 6 个内部方法对称)

以阶段一为例(L538–633):
```
_review_and_revise_director(max_rounds):
    for _ in range(max_rounds + 1):
        business   = _review_director_business(...)    # 业务审核
        compliance = _review_director_compliance(...)  # 合规审核
        if 都 PASS: return
        current = _revise_director_analysis(基于反馈重写)
```

PASS 判断 = 在响应文本中 `BUSINESS_PASS_PATTERN.search(...)` / `COMPLIANCE_PASS_PATTERN.search(...)`。

阶段二、三完全同构(只是 docs/prompt 不同),所以总共有 **3×(generate + review×2 + revise) = 12 个"_x_"私有方法**,占了 L510–882 这一大片。

#### 4.5.3 LLM 通信底盘 `_call_agent`(L884–905)

```
session = runtime.load_session(agent, episode)
system = _build_system_prompt(agent, docs)        # 把 agents/*.md + skills/* 拼成 system
messages = [system] + session.messages + [user]
response = llm_client.chat(messages, model=_model_for(agent))
session.messages += [user, assistant]              # 增量追加
runtime.save_session(session)
```

**关键设计**:
- `_collect_docs(docs)` 自动展开目录里所有 `*.md`,用 `===== 相对路径 =====` 分隔(L915)
- `_build_system_prompt` 加固定 preface,警告 LLM "只输出最终内容,别解释"(L907)
- `_model_for(agent)` 支持 `SEEDANCE_DIRECTOR_MODEL` / `SEEDANCE_ART_MODEL` / `SEEDANCE_STORYBOARD_MODEL` 单独配模型(L997)

#### 4.5.4 服化道格式解析 `_parse_art_sections`(L927)

服化道阶段要求 LLM 同时返回两块,用 `<<<CHARACTER_PROMPTS>>> ... <<<SCENE_PROMPTS>>> ...` 哨兵切分;格式不对就抛错(规则依赖模型服从性,见 [漫剧Agents.md §八.1](/root/Seedance%202.0%20分镜师团队/漫剧Agents.md))。

#### 4.5.5 资产合并/替换(L941–979)

- `_write_asset_content`:首次写入加标题,之后用 `\n\n---\n\n` 分隔追加
- `_remove_episode_sections`:`--force` 时按 `episode` 关键词匹配 chunk 删除旧块(粗粒度,见 [§八.4 局限](/root/Seedance%202.0%20分镜师团队/漫剧Agents.md))

### 4.6 CLI 装配(L1029–1113)

- `build_parser`:`status / start / design / prompt`,各有 `--force` 与 `--max-review-rounds`(默认 2)
- `main`:status 不需 LLM 直接走;其它三个统一装 `Project + RuntimeStore + GeminiGatewayClient → StandaloneRunner` 后派发,异常打印到 stderr 返回非零

### 4.7 设计要点速记

| 维度 | 选择 | 理由 |
|---|---|---|
| 依赖 | 仅标准库(urllib/json/argparse) | 零安装依赖,任何 Python 3.10+ 直接跑 |
| 状态机 | 文件系统作真源(`outputs/`+`assets/` 存在性) | 无 DB,可 git diff,可手工干预 |
| LLM 接入 | Gemini 优先 + 兼容网关 | 默认 `gemini-3-flash-preview`,可接 OneAPI / 任何兼容服务 |
| 角色规则 | system prompt 注入 `agents/*.md` + `skills/**/*.md` | 规则层不入代码,改 Markdown 即生效 |
| 审核闭环 | 同一 LLM 反过来审核 | 由 [`director-skill`](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/skills) 定义"PASS/FAIL+反馈" |
| 会话隔离 | `.seedance-runtime/<agent>__<ep>.json`,切集清空 | 防跨集污染 |

### 4.8 接 PipelinePlannerFlow 的天然衔接面

要包成 bp-server service,只需在 `StandaloneRunner` 外加一个薄 HTTP 包装,把 `run_start / run_design / run_prompt` 暴露三个 endpoint(或一个 `run_all`),输入 `{episode, style, medium, force, max_review_rounds}`,输出 `{director_md, character_md, scene_md, storyboard_md, reviews[]}` —— 已有的内部结构正好对位。

---

## 五、`seedance.py` 是否会覆盖 Claude skill 的旧产物

### 5.1 结论

**默认不会覆盖,且与 Claude skill 输出共用同一批文件**

### 5.2 设计上的保护

`seedance.py` 三个写盘入口都有"已存在则拒绝"的硬闸:

| 阶段 | 目标文件 | 检查点 | 行为 |
|---|---|---|---|
| `start` | `outputs/<ep>/01-director-analysis.md` | L390 `if output_path.exists() and not force: raise` | 报错退出 |
| `design` | `assets/character-prompts.md` + `scene-prompts.md` | L443 `has_episode_tag(...)` 任一命中且无 `--force` | 报错退出 |
| `prompt` | `outputs/<ep>/02-seedance-prompts.md` | L495 `if prompt_output.exists() and not force: raise` | 报错退出 |

不带 `--force` 跑,Claude skill 之前留下的产物会**原封不动**。

### 5.3 带 `--force` 时,这几种覆盖会发生

1. **`outputs/<ep>/0X-*.md` — 整文件覆盖**
   `write_text` 直接 overwrite,无备份、无 diff。

2. **`assets/character-prompts.md` / `scene-prompts.md` — 按集替换块**(粗粒度)
   `_remove_episode_sections` 用 `\n\n---\n\n` 把文件切成 chunks,**只要 chunk 文本里出现 `ep01` 字样就整块删掉**,再追加新内容。
   
   风险:
   - Claude skill 写的 chunk 如果**没带 `epXX` 标签** → 不会被删,但新内容会追加在末尾(可能造成重复条目)
   - Claude skill 写的 chunk 如果**正文里碰巧提到了 `ep01`**(例如"参考 ep01 的造型") → 会被误删
   - 块之间必须用 `---` 分隔才识别;如果 Claude skill 用了不同分隔风格,整文件会被当成一个 chunk 处理

3. **`.seedance-runtime/` — 切集时清空所有 agent session**
   `ensure_episode` 切到新集时会清掉所有本地会话(不影响产物文件,只丢上下文)。

4. **`.agent-state.json` — 会被本地 runner 重写**
   原来 Claude 用它存 `agentId`,现在改存本地 session id;字段名仍是 `agentId`,但语义已变。

### 5.4 不会动的东西

- `script/` 下的剧本文件 — 只读
- `agents/*.md` / `skills/**/*.md` — 只读(作 system prompt)
- `CLAUDE.md` / `README*.md` — 只读

### 5.5 实操建议

如果想保留 Claude skill 的旧产物再跑一次对比:

```bash
# 1. 先备份(seedance.py 自己不做备份)
cp -r outputs outputs.claude.bak
cp assets/character-prompts.md assets/character-prompts.md.claude.bak
cp assets/scene-prompts.md assets/scene-prompts.md.claude.bak

# 2. 然后再 --force 跑
python3 seedance.py start ep01 --force
```

或者把新产出写到不同集号(如 `ep01b`),完全规避覆盖问题。

---

## 六、审核机制:在哪一步、审什么

### 6.1 每阶段的审核-修订循环

每个阶段写完草稿之后,**进入"审核-修订"循环**,直到双审核都 PASS 或达到 `--max-review-rounds`(默认 2)。

```
generate(草稿) → 写盘
   │
   └─▶ for _ in range(max_rounds + 1):
           ① 业务审核 (_review_*_business)
           ② 合规审核 (_review_*_compliance)
           if 都 PASS: break
           ③ 修订   (_revise_*)  ← 把审核反馈喂回生成 agent 重写
```

三阶段都是这个对称结构,共 6 次审核(每阶段 2 次):

| 阶段 | 生成产物 | 审核者 | 业务审核 | 合规审核 |
|---|---|---|---|---|
| `start` 阶段一 | `01-director-analysis.md` | director 自审 | `_review_director_business` | `_review_director_compliance` |
| `design` 阶段二 | `character-prompts.md` + `scene-prompts.md` | director 跨审 art-designer | `_review_art_business` | `_review_art_compliance` |
| `prompt` 阶段三 | `02-seedance-prompts.md` | director 跨审 storyboard-artist | `_review_storyboard_business` | `_review_storyboard_compliance` |

PASS 判定 = 在审核响应文本里正则匹配:
- `BUSINESS_PASS_PATTERN = 业务审核：PASS`
- `COMPLIANCE_PASS_PATTERN = 合规审核：PASS`

匹配不到就视为 FAIL → 把审核全文当反馈传给 `_revise_*` 重写。

### 6.2 审核标准(规则在 skills/)

具体审核标准**不在 `seedance.py` 里**,而是写在 [`skills/`](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/skills) 的 Markdown 规则包里,审核时作为 system prompt 注入。一一对应:

| 审核函数 | 加载的规则文档(system prompt) | 审什么 |
|---|---|---|
| `_review_director_business` | `agents/director.md` + `skills/script-analysis-review-skill/` | 讲戏本是否覆盖剧本所有剧情点;人物/场景/光影/镜头规划/导演阐述是否齐全;视觉风格与目标媒介是否落实 |
| `_review_director_compliance` | director.md + `skills/compliance-review-skill/` | 文本是否含违规/敏感/版权/暴力色情内容;是否符合平台规范 |
| `_review_art_business` | director.md + `skills/art-direction-review-skill/` | character/scene 双区块是否齐;每个新增人物/场景是否给出统一的"基础形象 + 变体"提示词;是否与导演讲戏本一致 |
| `_review_art_compliance` | director.md + compliance-review-skill | 服化道描述是否触红线 |
| `_review_storyboard_business` | director.md + `skills/seedance-prompt-review-skill/` | Seedance 提示词是否对每个剧情点都覆盖;是否引用了正确的人物/场景定义;镜头语言是否符合 Seedance 平台约束 |
| `_review_storyboard_compliance` | director.md + compliance-review-skill | 同上 |

**审核者就是 director agent 本身**(三阶段都用 director 模型,只是换 system prompt 里挂的 skill);三个生成 agent(director / art-designer / storyboard-artist)与三个 review skill 的对应关系在 [漫剧Agents.md §二.3](/root/Seedance%202.0%20分镜师团队/漫剧Agents.md) 列得很清楚。

### 6.3 ep01 实际审核轨迹

- **业务**:director 用 `script-analysis-review-skill` 检查——剧情点编号(P01–P06)、人物清单、场景清单、剧情结构总览四块齐全,每个剧情点都有"人物/场景/镜头组/时长建议/镜头规划/导演阐述",视觉风格表头也在 → 通常 PASS
- **合规**:director 用 `compliance-review-skill` 检查——P03 浇咖啡冲突、P04 咬喉结、"老娘不干了"等强冲突措辞会被打分但通常给过(短剧合规线宽松) → PASS

CLI 末尾打印的:

```
- director 业务审核: PASS
- director 合规审核: PASS
```

就是这两次审核的结论。

---

## 七、文生图拆分:人物/场景被单独喂给文生图

### 7.1 设计证据(直接来自原 Claude 配置)

**1. `agents/art-designer.md` 输出规范明写:**
> - 中文叙事描述式提示词，不要用关键词堆叠
> - **可直接复制到文生图工具生成图片**

**2. 产物拆成两个独立文件,跨集累积:**
```
assets/character-prompts.md   ← 每个角色一段完整文生图 prompt
assets/scene-prompts.md       ← 每个场景一段完整文生图 prompt
```
([CLAUDE.md `[文件结构]`](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/CLAUDE.md))

**3. 分镜师阶段不重新写人物/场景外观,而是 `@引用`:**

> `agents/storyboard-artist.md`:
> - 建立素材对应表，**在提示词中使用 @引用语法关联人物和场景素材**

也就是说:**人物/场景是"先单独生图、后被分镜引用"的素材**,不是被嵌进每条镜头 prompt 里的一次性描述。

### 7.2 流水线全貌

```
阶段一  director           → 01-director-analysis.md
                              ├─ 人物清单(角色名 + 外观关键词 + 素材状态)
                              └─ 场景清单(场景名 + 光线 + 着装 + 素材状态)
                                  │
                                  ▼  (供 art-designer 读)
阶段二  art-designer        → assets/character-prompts.md   ◀── 单独喂文生图
                            → assets/scene-prompts.md       ◀── 单独喂文生图
                                  │
                                  ▼  (供 storyboard-artist 读)
阶段三  storyboard-artist   → 02-seedance-prompts.md
                              每个镜头 prompt 用 @陈一一 / @酒吧走廊
                              引用上面已经生成的素材图
                                  │
                                  ▼
                         Seedance 2.0 视频生成(吃图 + 吃 prompt)
```

### 7.3 为什么这么拆 — 工业上的三重收益

| 收益 | 解释 |
|---|---|
| **形象一致性** | 同一角色全片用同一张参考图,Seedance 不会每镜头长一张脸 |
| **跨集复用** | `assets/*-prompts.md` 跨集累积,后续集 `--force` 增量,角色/场景图只生一次 |
| **生产解耦** | 文生图(角色/场景立绘)与文生视频(动态镜头)分两条管线,失败可独立重跑 |

### 7.4 ep01 产物对应关系

[`01-director-analysis.md`](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/outputs/ep01/01-director-analysis.md) 末尾两张表已经是给 art-designer 的"派单"清单:

```
人物清单: 陈一一 / 霍宴 (素材状态: 新增)  → 进 character-prompts.md → 文生图出立绘
场景清单: 面试办公室 / 律所 / 酒吧走廊 / 天恒律所 (新增) → 进 scene-prompts.md → 文生图出场景
张建国 (一次性配角) → 不进素材库,直接在 P02/P03 的 storyboard prompt 里描写
```

`张建国` 那条注释("不进服化道参考图设计清单,但其外观已在导演阐述中具体描述,**分镜师可直接在提示词中用工笔描写**")就是这套机制的反例,正好印证了规则:**进素材清单的 = 单独喂文生图 + 后续 @引用;不进的 = 一次性 inline 描写**。

### 7.5 与 AI漫剧合集体系的接续点

如果接到 [AI漫剧](/var/www/html/resourcespace/AI漫剧.md) 体系,正好对位:

| Seedance 产物 | 文生图后 | 入 RS |
|---|---|---|
| `character-prompts.md` 每条 | → 角色立绘图 | Type 17 Character → 人物库合集 |
| `scene-prompts.md` 每条 | → 场景图 | Type 18 Scene → 场景库合集 |
| `02-seedance-prompts.md` 每条 | → Seedance 视频 | Type 15 Shot → 镜头合集,`resource_related` 关联上面的人物/场景 |

即 §1.3 衔接路径的具体落地方式:**素材资源先入库,镜头资源再绑定**,与原 Claude 工作流的拆分粒度天然对齐。

---

## 八、ep01 分镜的 @引用标注核对

### 8.1 标注矩阵

[`02-seedance-prompts.md`](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/outputs/ep01/02-seedance-prompts.md) 全部 6 个分镜都按规范标了 @ 引用:

| 剧情点 | 主角(@图片) | 场景(@图片) | 变体说明 |
|---|---|---|---|
| **P01** | `@图片2` 霍宴 + `@图片1` 陈一一 | `@图片3` 面试办公室 | — |
| **P02** | `@图片1` 陈一一 | `@图片4` 律所办公室 | 张建国(无 @ — 一次性配角文字描写) |
| **P03** | `@图片1` 陈一一 | `@图片4` 律所办公室 | 同上 |
| **P04** | `@图片1`(变体:酒吧连衣裙装) + `@图片2` 霍宴 | `@图片5` 酒吧走廊 | 陈一一变体 |
| **P05** | `@图片2` 霍宴 + `@图片1`(变体:酒吧连衣裙装) | `@图片5` 酒吧走廊 | 陈一一变体 |
| **P06** | `@图片1`(变体:面试职业装) + `@图片2`(变体:面试着装) | `@图片6` 天恒律所面试室 | 双方都标变体 |

### 8.2 值得注意的细节

1. **顶部素材对应表完整** — 6 个 @图片(2 人物 + 4 场景),每条标了对应基础形象/光线特征
2. **变体语法正确** — `@图片1(变体:酒吧连衣裙装)` 复用同一人物 ref,通过括号说明换装,避免再开一张参考图(P04/P05/P06)
3. **张建国不带 @** — 与 [01-director-analysis.md 末尾](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/outputs/ep01/01-director-analysis.md) 的"一次性配角不进素材清单,分镜师工笔描写"规则**一致**
4. **每条都加了 `negative prompt: 文字，字幕，标题，水印`** — Seedance 平台规范
5. **每条都给了音效行** — 视频生成的辅助通道

### 8.3 一致性核对(对照素材对应表)

```
@图片1 陈一一            → 出现在 P01/P02/P03/P04/P05/P06  ✓
@图片2 霍宴              → 出现在 P01/P04/P05/P06          ✓
@图片3 面试办公室         → P01                            ✓ (单次)
@图片4 律所办公室         → P02/P03                        ✓
@图片5 酒吧走廊          → P04/P05                        ✓
@图片6 天恒律所面试室     → P06                            ✓
```

**6 个素材全部被引用,无遗漏、无超界引用** — 这份 storyboard 已经是合格的、可直接喂 Seedance 2.0 的完整脚本,前提是先用 [character-prompts.md](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/assets/character-prompts.md) 和 [scene-prompts.md](/root/Seedance%202.0%20分镜师团队/Seedance%202.0%20分镜师团队/assets/scene-prompts.md) 把 @图片1–6 这 6 张参考图先生出来。

---

## 九、归档版本

- v1.0 (2026-05-06):综合 8 节,覆盖产物衔接、CrewAI/pipeline 接入、`seedance.py` 代码结构、覆盖风险、审核机制、文生图拆分、ep01 标注核对

---

## 十、导演 skill 的"配音"提示词规范（§36 提取记录）

**位置**: `skills/director-skill/SKILL.md` 第六步「提取音色清单」  
**触发**: director 阶段产出 `outputs/<ep>/01-director-analysis.md` 中的 `## 音色清单` 表  
**下游**: art-designer 原样照抄到 `character-prompts.md` 各角色的 `**音色垫词**` 副段；storyboard-artist 把它**原样内联**到每句台词前（方括号包裹）

### 10.1 核心定义

**音色垫词** = 60-100 字中文叙事描述，作为角色嗓音/语气的定型。

### 10.2 必含 8 个维度（融合成一整段叙事，不分条）

| 维度 | 取值示例 |
|---|---|
| 性别 + 年龄段 | "男声，青壮年音色" / "女声，少女音色" |
| 音调 | 低 / 中等偏低 / 中等 / 中等偏高 / 高 |
| 音色质感 | 沉稳 / 磁性 / 清亮 / 冷冽 / 温婉 / 沙哑 / 清脆 |
| 声线特质 | 清冽带哑 / 浑厚干净 / 柔和通透 / 明亮清脆 |
| 发音方式 | 利落克制 / 干净标准 / 含混 |
| 气息 | 沉敛绵长 / 平稳深沉 / 充沛平稳 / 急促 |
| 吐字 + 语速 | 锋利清晰 / 偏慢 / 中等 / 偏快 |
| 言语风格 / 情绪基调 | "不容置疑的掌控力" / "与生俱来的温婉与真诚感" / "疏离阴鸷与漫不经心的压迫感" |

### 10.3 官方风格示例（4 段，直接照此粒度写）

```
男主：男声，青壮年音色，音调低，音色质感沉稳且带有磁性，声音浑厚，发音
干净，气息平稳深沉，吐字清晰、语速偏慢，话语间有种不容置疑的掌控力。

男反派 Arthur：男声，青年音色，音调中等偏低，音色质感冷冽、低沉，声线清冽
带哑，发音方式利落克制，气息沉敛绵长，吐字锋利清晰，自带一种疏离阴鸷与漫
不经心的压迫感。

女主 Karya：女声，青年音色，音调中等偏高，音色质感明亮、清脆，声音清亮柔
和，发音方式干净，气息充沛平稳，吐字清晰，带有一种与生俱来的温婉与真诚感。

女反派 Mia：年轻女性声音，18 岁少女，音色清亮柔和，声音干净通透，气息平稳
自然，语速中等偏慢，吐字清晰，发音标准，语气温柔但带轻微控制感，情绪克制
内敛，带若有若无的微笑感，整体风格温婉却隐藏危险感。
```

### 10.4 筛选规则

- 人物清单里**所有列入的角色**都必须有音色垫词（与人物清单一一对应）
- 群演 / 一次性配角不在人物清单 → **不写**音色垫词
- 嗓音变化（变声 / 老化 / 受伤后嘶哑）→ 在音色清单里标"变体"并写新垫词
- art-designer 把变体作为副段写到 character-prompts.md，触发剧情点要明确标注

### 10.5 下游 storyboard 怎么用（强制内联格式）

```
角色每说一句台词，前面都必须原样拼上该角色的音色垫词，方括号 [...] 包裹。
格式：角色名 @图片N[音色垫词整段]:"台词"

示例：
Thalion @图片3 (位置参考@图片6)[男声，青壮年音色，音调低，音色质感沉稳且
带有磁性，声音浑厚，发音干净，气息平稳深沉，吐字清晰、语速偏慢，话语间有种
不容置疑的掌控力]:"You have until the next blood moon. Choose wisely."
```

同一镜头同一人说 N 句 → 拼 N 次。是 Seedance 下游 TTS 解析音色的钩子，**不能省略**。

### 10.6 publish 落地路径

- art-designer 把音色垫词写入 `character-prompts.md` → seedance.py `_write_asset_content` 走 §38 frontmatter
- publish 阶段读 character-prompts.md 的"音色垫词"段 → 存到 Character 实体 `field154` (voice_prompt)
- 当前**未单独建 Voice (type=19) 实体**（§36 文档列为"未决项"），voice_prompt 文本直接挂在 Character 上，TTS 上游用时取该字段

---

## 十一、导演 skill 的"道具"提示词规范（§37 提取记录）

**位置**: `skills/director-skill/SKILL.md` 第七步「提取道具清单」  
**模板**: `skills/director-skill/templates/director-analysis-template.md` 的 `## 道具清单（§37 新增）` 段  
**触发**: director 阶段产出 `outputs/<ep>/01-director-analysis.md` 中的 `## 道具清单` 表  
**下游**: art-designer 据此写 `assets/prop-prompts.md`（§38 起 seedance.py 真正生成该文件，§37 时只有 SKILL 而 Python 还没写入）；publish 建 Prop (type=21) 实体 + 参考图

### 11.1 定义

**道具** = Character / Scene 之外的第三种实体——被人拿在手里 / 放在场景里 / 独立特写镜头出现的关键物品（手机、武器、医疗器械、证件、信件、品牌商品等）。

### 11.2 筛选标准（满足任一即列入清单）

```
✓ 本集出现在 2 个及以上剧情点的道具（"被人持"和"独立特写"两种形态合计）
✓ 本集只出现 1 次，但根据已有剧本判断后续集数会再次出场的道具
✓ 在剧情中起到叙事关键作用的道具（如"母亲的旧手机引发回忆"
                                       "那封信改变了人物决定"）
```

### 11.3 不列入清单（一次性背景物）

```
✗ 街景里的随意物件
✗ 餐桌上的普通餐具
✗ 办公桌上一般文件
→ 这些不进清单，但在讲戏本的导演阐述中照常描述
```

### 11.4 每个道具记录 4 个字段

| 字段 | 取值 |
|---|---|
| 道具名 | 中文短词，如"林远的智能手机" / "父亲的金边眼镜" |
| 类型 | 电子产品 / 武器 / 服饰配饰 / 文件单据 / 医疗器械 / 餐具炊具 / 家具 / 交通工具 / 其他 |
| 外观关键词 | 材质、颜色、形状、尺寸、状态、品牌 / 无品牌、特殊标记 |
| 素材状态 | 新增 / 复用 / 变体 |

### 11.5 产物模板格式（来自 director-analysis-template.md）

```markdown
## 道具清单

| 道具 | 类型 | 外观关键词 | 素材状态 |
|------|------|----------|---------|
| 林远的智能手机 | 电子产品 | 黑色金属边框，亮屏，深蓝主屏，无品牌 logo | 新增 |
| Dr. Miller 的医疗报告 | 文件单据 | A4 白纸，模糊的医院 logo，中间血液检测表格 | 新增 |
| 王阿姨的血糖仪 | 医疗器械 | 白色塑料圆形，LED 屏，腕带式贴片 | 新增 |
```

### 11.6 素材状态 3 种取值

| 状态 | 写法 | 含义 |
|---|---|---|
| **新增** | "新增" | 首次出场，服化道要设计新提示词 |
| **复用** | "复用 prop-001" | 跟已有素材一致 |
| **变体** | "变体 prop-001（裂屏版，P05 触发）" | 状态变化，附原素材 ID + 触发剧情点 |

### 11.7 变体常见 4 类（必须标"变体"）

```
损坏：手机裂屏 / 衣物撕裂 / 报告被烧 / 武器卷刃
染污：信件被血染 / 衣物被泥溅 / 文件被水浸
升级：旧手机 → 新手机 / 纸质报告 → 电子报告
携带 vs 摆放：被人持 vs 单独陈列（同一道具，出图角度/光影不同）
```

### 11.8 §37 落地链路（含 §38 修复后的最终状态）

```
director (LLM)       → 01-director-analysis.md  ## 道具清单 表
                        ↓
art-designer (LLM)   → assets/prop-prompts.md
                        ↑ §38 起 seedance.py 增 <<<PROP_PROMPTS>>> 第三块解析
                        ↑ §37 时此文件无人写,链路缺失
                        ↓
publish (PHP)        → 解析 prop-prompts.md (parse_prop_md, §37 加的)
                        ↓
                        ai_series_create_resource(type=21, ...)
                        + ai_series_link_project_asset
                        + per-variant publish_one_photo (aspect=1:1)
                        + resource_related 关联到 Prop 实体
                        + 加入 prop_library 合集
                        ↓
                        Prop (type=21) 实体 + N 张 photo 入库
```

### 11.9 §37 落地最后一公里（§38 解决）

**问题**: §37 当时只改了 SKILL/template 让 LLM 写道具，但 seedance.py 的 art-designer prompt 是固定的两块（CHARACTER + SCENE），LLM 即使输出第三块也被忽略 → `prop-prompts.md` 永远是缺的 → 整条道具链断。

**修复（§38）**: 
- SECTION_PATTERN 升级为 3 块匹配（PROP_PROMPTS 可选）
- `_parse_art_sections` 返回 3 元组
- `_review_and_revise_art_design` 全链路传递 prop_content
- `run_design` 增加第三个 `_write_asset_content` 写 prop-prompts.md
- `_generate_art_design` LLM prompt 增加 `<<<PROP_PROMPTS>>>` 引导

### 11.10 道具品牌敏感处理（强制）

art-design-skill 规定（防止触发火山版权过滤）：

- 真实商业品牌 logo / 商标 / 字样禁止具体描述
- 用 "无品牌" 或 "模糊处理的品牌区域" 替代
- 通用品类（"一部黑色金属边框智能手机"）替代具体名（"iPhone"）

### 11.11 写实题材 vs 漫画风的道具拍摄禁忌

- 现代都市 / 写实题材中，**避免描述物理破坏场景**（踹门碎片飞溅 / 砸碎屏幕 / 物品爆裂等）——AI 视频模型处理破坏类场景易出现穿帮 / 闪烁 / 变形，应改用动作 / 运镜传达冲突
- 写实题材中，**避免使用漫画 / 动漫视觉符号**（"眼镜闪过一道冷光" / "镜片闪光"等）——AI 可能将其理解为漫画特效帧导致画风突变，应改用物理光学描述替代

---

## 十二、归档版本

- v1.0 (2026-05-06):综合 8 节,覆盖产物衔接、CrewAI/pipeline 接入、`seedance.py` 代码结构、覆盖风险、审核机制、文生图拆分、ep01 标注核对
- v1.1 (2026-05-13): §36 配音 + §37 道具 提示词规范完整提取（第十、十一节）
