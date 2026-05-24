# Mock 数据说明

> 本测试套件**不烧 token**,所有 LLM / 出图调用都通过下列 mock 机制短路。

## 1. OCF 仅解析模式(`__PARSE_ONLY__`)

**入口**:OCF modal 底部「☐ 仅解析(无 AGI)」checkbox

**前端**:[ai_series_prototype.html](/var/www/html/resourcespace/10.7/ai_series_prototype.html) OCF modal 提交时,把 `models.image_model` 全部设成字符串 `"__PARSE_ONLY__"`,后端见此值即跳出图分支。

**后端短路点**:

```php
// ai_series_one_click_film.php line 2156
if ($image_model === '__PARSE_ONLY__') {
    ai_series_ocf_progress_record(... 'done', null, 'parse_only — 无 AGI,不出图、不建 Photo');
    return 0;
}
```

```php
// ai_series_one_click_film.php line 2381
//   publish_one_photo 见此值即只建空 Photo 资源、不调出图。
```

**效果**:
- LLM 解析(剧本拆人物/拆场景/拆道具)**正常跑**
- 工作目录产出 `outputs/director.json` + `prompts.md` + 各种 md
- **不建 Photo / Audio 资源**
- **不建 character/scene/prop/voice 实体**(§46c 规则)
- 数字资产屏归并 banner 出现(§48 走向 2)

## 2. seedance 跳过

**入口**:OCF modal 不勾「直接出图」(C 模式)

**效果**:OCF 主流程跑完 publish 阶段就停,不进 seedance 三阶段(导演讲戏 / 服化道 / 分镜),不烧视频 token。

## 3. 测试集次/场次命名

- **ep_num=99**:用 99 避开真集次(项目实际 ep01-ep20)
- 场次名 `E2E测试场1` / `E2E测试场2`:明显可识别,不跟用户真场次冲突
- 集次标题 `E2E测试集`:同上

## 4. 测试账号映射

| 账号 | user_ref | company_ref | team_node | usergroup |
|---|---|---|---|---|
| muyaowu713001@gmail.com | 6 | 4 (悦年轻) | 1562 (TEAM_YUENIANQING) | 43 (TPL_LEAD) |
| 664534335@qq.com | 15 | 2 (佰乐康健) | 1560 (TEAM_BAILEKANGJIAN) | 45 (TPL_OPS_LEAD) |

## 5. 缩略图本地生成

所有缩略图脚本都本地跑(GD + Puppeteer),**不调外部 API**:

| 类型 | 脚本 |
|---|---|
| Pt 卡(type=2) | `/root/tldraw-local-server/generate-pt-thumbnail.php`(§51c 重写) |
| Shot/Script(type=15/16 txt) | `/root/tldraw-local-server/generate-prompt-screenshot-single.js` |
| HTML(type=5) | `/root/tldraw-local-server/generate-html-thumbnail.php` |

## 6. testtest5 基线状态(2026-05-24)

- project_ref = 16, company_ref = 4 (悦年轻)
- 1 个真集次 ep01(集名《第1集》)
- 0 个 character/scene/prop/voice 实体(§50 模板裂变后清零)
- 6 张 Pt 卡(系统默认模板裂变出来的独立副本):
  - 103959 人物提示词库
  - 103960 场景提示词库
  - 103961 视频提示词库
  - 103962 剧本提示词库
  - 103963 道具提示词库
  - 103964 音色提示词库
- testtest5 tree 节点总数 ~30(随历史 reset 浮动)
