# Seedance Standalone Runner

这个目录现在可以通过 `seedance.py` 作为独立程序运行，不再依赖 Claude 的子 Agent 调度。

## 运行方式

只查看项目状态，不需要模型配置：

```bash
python3 seedance.py status
```

执行三阶段流程前，需要提供一个 Gemini 接口（默认通过 OneAPI / 兼容网关接入）：

```bash
export GEMINI_BASE_URL="http://127.0.0.1:3000/v1"
export GEMINI_API_KEY="your-key"
export SEEDANCE_MODEL="gemini-3-flash-preview"
```

如果你使用 OneAPI，也可以直接用同样的兼容地址和密钥：

```bash
export ONEAPI_BASE_URL="http://127.0.0.1:3000/v1"
export ONEAPI_API_KEY="your-key"
```

然后运行：

```bash
python3 seedance.py start ep01 --style "现代都市偶像甜宠剧" --medium "短剧"
python3 seedance.py design ep01
python3 seedance.py prompt ep01
```

## 命令说明

- `python3 seedance.py status`
  扫描 `script/`、`outputs/`、`assets/`，显示当前集数和当前阶段。

- `python3 seedance.py start [epXX] --style ... --medium ...`
  调用导演流程，生成 `outputs/<epXX>/01-director-analysis.md`，并执行业务审核和合规审核。

- `python3 seedance.py design [epXX]`
  调用服化道流程，生成并审核本集新增的人物提示词和场景提示词，然后写入：
  - `assets/character-prompts.md`
  - `assets/scene-prompts.md`

- `python3 seedance.py prompt [epXX]`
  调用分镜流程，生成 `outputs/<epXX>/02-seedance-prompts.md`，并执行业务审核和合规审核。

可选参数：

- `--force`
  允许覆盖或替换已有产物。

- `--max-review-rounds 2`
  审核失败后的最大修订轮次，默认 `2`。

## 模型配置

通用默认模型变量：

- `SEEDANCE_MODEL`

也可以按角色拆分模型：

- `SEEDANCE_DIRECTOR_MODEL`
- `SEEDANCE_ART_MODEL`
- `SEEDANCE_STORYBOARD_MODEL`

超时设置：

- `SEEDANCE_TIMEOUT_SECONDS`

## 状态文件

- `.agent-state.json`
  现在由独立运行器维护，记录本地 session id。

- `.seedance-runtime/`
  独立运行器新增的本地运行时目录，保存 agent 对话历史和当前集元数据。

## 实现原则

- 现有 `CLAUDE.md`、`agents/`、`skills/` 继续作为规则源，不需要重写。
- 独立运行器只负责读取这些 markdown，组织提示词，请求模型，写回产物文件。
  - 模型默认按 Gemini 接入，底层仍走兼容 `/v1/chat/completions` 的网关，因此可以接 OneAPI、本地模型网关或其他兼容服务。

## 当前边界

- 这个版本是最小独立闭环，重点是脱离 Claude 运行，不是完整产品化界面。
- 它依赖模型严格遵守输出格式，尤其是服化道阶段的双区块输出。
  - `status` 命令不依赖任何模型配置，其余命令都需要 Gemini / OneAPI 接口可用。