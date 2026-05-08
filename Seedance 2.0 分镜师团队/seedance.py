#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence
from urllib import error, request


EPISODE_PATTERN = re.compile(r"(ep\d{2})", re.IGNORECASE)
BUSINESS_PASS_PATTERN = re.compile(r"业务审核：\s*PASS")
COMPLIANCE_PASS_PATTERN = re.compile(r"合规审核：\s*PASS")
SECTION_PATTERN = re.compile(
    r"<<<CHARACTER_PROMPTS>>>\s*(.*?)\s*<<<SCENE_PROMPTS>>>\s*(.*)",
    re.DOTALL,
)

AGENT_FILE_MAP = {
    "director": "agents/director.md",
    "art-designer": "agents/art-designer.md",
    "storyboard-artist": "agents/storyboard-artist.md",
}


@dataclass
class EpisodeStatus:
    episode: str
    script_path: Path
    director_output_exists: bool
    prompt_output_exists: bool
    has_character_assets: bool
    has_scene_assets: bool

    @property
    def state_label(self) -> str:
        if self.director_output_exists and self.prompt_output_exists:
            return "已完成"
        if self.director_output_exists or self.has_character_assets or self.has_scene_assets:
            return "进行中"
        return "未开始"

    @property
    def current_stage(self) -> str:
        if self.director_output_exists and self.prompt_output_exists:
            return "已完成"
        if not self.director_output_exists:
            return "导演分析阶段"
        if not (self.has_character_assets and self.has_scene_assets):
            return "服化道设计阶段"
        if not self.prompt_output_exists:
            return "分镜编写阶段"
        return "已完成"


@dataclass
class ReviewResult:
    name: str
    passed: bool
    text: str


@dataclass
class AgentSession:
    agent_name: str
    episode: str
    session_id: str
    messages: list[dict[str, str]]


class SeedanceProject:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.script_dir = root / "script"
        self.assets_dir = root / "assets"
        self.outputs_dir = root / "outputs"
        self.agent_state_path = root / ".agent-state.json"
        self.runtime_dir = root / ".seedance-runtime"

    def list_script_files(self) -> list[Path]:
        if not self.script_dir.exists():
            return []
        files = [
            path
            for path in self.script_dir.iterdir()
            if path.is_file() and path.suffix.lower() in {".md", ".txt"}
        ]
        return sorted(files)

    def extract_episode(self, path: Path) -> str | None:
        match = EPISODE_PATTERN.search(path.stem)
        if match:
            return match.group(1).lower()
        return None

    def read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def write_text(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def has_episode_tag(self, path: Path, episode: str) -> bool:
        if not path.exists():
            return False
        return episode.lower() in self.read_text(path).lower()

    def get_episode_statuses(self) -> list[EpisodeStatus]:
        character_assets = self.assets_dir / "character-prompts.md"
        scene_assets = self.assets_dir / "scene-prompts.md"
        statuses: list[EpisodeStatus] = []
        for script_path in self.list_script_files():
            episode = self.extract_episode(script_path)
            if not episode:
                continue
            episode_dir = self.outputs_dir / episode
            director_output = episode_dir / "01-director-analysis.md"
            prompt_output = episode_dir / "02-seedance-prompts.md"
            statuses.append(
                EpisodeStatus(
                    episode=episode,
                    script_path=script_path,
                    director_output_exists=director_output.exists(),
                    prompt_output_exists=prompt_output.exists(),
                    has_character_assets=self.has_episode_tag(character_assets, episode),
                    has_scene_assets=self.has_episode_tag(scene_assets, episode),
                )
            )
        return statuses

    def read_agent_state(self) -> dict[str, str]:
        if not self.agent_state_path.exists():
            return {}
        try:
            data = json.loads(self.agent_state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(key): str(value) for key, value in data.items()}

    def write_agent_state(self, agent_state: dict[str, str]) -> None:
        payload = {
            "director": agent_state.get("director", ""),
            "art-designer": agent_state.get("art-designer", ""),
            "storyboard-artist": agent_state.get("storyboard-artist", ""),
        }
        self.write_text(self.agent_state_path, json.dumps(payload, ensure_ascii=False, indent=4))

    def script_for_episode(self, episode: str) -> Path:
        normalized = episode.lower()
        for script_path in self.list_script_files():
            if self.extract_episode(script_path) == normalized:
                return script_path
        raise ValueError(f"未找到 {normalized} 对应的剧本文件。")

    def resolve_episode(self, episode: str | None) -> str:
        if episode:
            normalized = episode.lower()
            if not EPISODE_PATTERN.fullmatch(normalized):
                raise ValueError("集数格式应为 ep01、ep02 这类形式。")
            self.script_for_episode(normalized)
            return normalized

        statuses = self.get_episode_statuses()
        if not statuses:
            raise ValueError("script/ 中没有可用剧本文件。")
        if len(statuses) == 1:
            return statuses[0].episode

        current = choose_current_episode(statuses)
        if current is None:
            raise ValueError("存在多个剧本文件，请显式传入集数，例如: ep01")
        return current.episode

    def output_dir_for(self, episode: str) -> Path:
        return self.outputs_dir / episode

    def director_output_for(self, episode: str) -> Path:
        return self.output_dir_for(episode) / "01-director-analysis.md"

    def prompt_output_for(self, episode: str) -> Path:
        return self.output_dir_for(episode) / "02-seedance-prompts.md"

    @property
    def character_prompts_path(self) -> Path:
        return self.assets_dir / "character-prompts.md"

    @property
    def scene_prompts_path(self) -> Path:
        return self.assets_dir / "scene-prompts.md"


def choose_current_episode(statuses: Iterable[EpisodeStatus]) -> EpisodeStatus | None:
    ordered = list(statuses)
    for status in ordered:
        if status.current_stage != "已完成":
            return status
    return ordered[0] if ordered else None


def format_agent_state(agent_state: dict[str, str]) -> str:
    if not agent_state:
        return "全新会话"
    if any(value.strip() for value in agent_state.values()):
        return "已检测到历史会话"
    return "全新会话"


def next_action(stage: str, episode: str) -> str:
    mapping = {
        "导演分析阶段": f"运行: python3 seedance.py start {episode}",
        "服化道设计阶段": f"运行: python3 seedance.py design {episode}",
        "分镜编写阶段": f"运行: python3 seedance.py prompt {episode}",
        "已完成": "等待处理下一集，或运行: python3 seedance.py status",
    }
    return mapping.get(stage, "运行: python3 seedance.py status")


class RuntimeStore:
    def __init__(self, project: SeedanceProject) -> None:
        self.project = project
        self.base_dir = project.runtime_dir
        self.sessions_dir = self.base_dir / "sessions"
        self.meta_path = self.base_dir / "meta.json"

    def ensure_episode(self, episode: str) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        current_episode = self._read_meta().get("current_episode", "")
        if current_episode == episode:
            return

        for session_path in self.sessions_dir.glob("*.json"):
            session_path.unlink()

        self._write_meta({"current_episode": episode})
        self.project.write_agent_state(
            {
                "director": "",
                "art-designer": "",
                "storyboard-artist": "",
            }
        )

    def load_session(self, agent_name: str, episode: str) -> AgentSession:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        session_path = self.sessions_dir / f"{agent_name}.json"
        if session_path.exists():
            try:
                data = json.loads(session_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
            if data.get("episode") == episode and data.get("session_id"):
                return AgentSession(
                    agent_name=agent_name,
                    episode=episode,
                    session_id=str(data["session_id"]),
                    messages=list(data.get("messages", [])),
                )

        session = AgentSession(
            agent_name=agent_name,
            episode=episode,
            session_id=uuid.uuid4().hex[:16],
            messages=[],
        )
        self.save_session(session)
        return session

    def save_session(self, session: AgentSession) -> None:
        payload = {
            "agent_name": session.agent_name,
            "episode": session.episode,
            "session_id": session.session_id,
            "messages": session.messages,
        }
        session_path = self.sessions_dir / f"{session.agent_name}.json"
        session_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        agent_state = self.project.read_agent_state()
        agent_state[session.agent_name] = session.session_id
        self.project.write_agent_state(agent_state)

    def _read_meta(self) -> dict[str, str]:
        if not self.meta_path.exists():
            return {}
        try:
            data = json.loads(self.meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}

    def _write_meta(self, data: dict[str, str]) -> None:
        self.meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass
class LLMConfig:
    api_key: str
    base_url: str
    default_model: str
    timeout_seconds: int

    @classmethod
    def from_env(cls) -> LLMConfig:
        api_key = (
            os.getenv("GEMINI_API_KEY")
            or os.getenv("ONEAPI_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or ""
        )
        base_url = (
            os.getenv("GEMINI_BASE_URL")
            or os.getenv("ONEAPI_BASE_URL")
            or os.getenv("OPENAI_BASE_URL")
            or ""
        )
        default_model = (
            os.getenv("SEEDANCE_MODEL")
            or os.getenv("GEMINI_MODEL")
            or os.getenv("OPENAI_MODEL")
            or "gemini-3-flash-preview"
        )
        timeout_seconds = int(os.getenv("SEEDANCE_TIMEOUT_SECONDS", "300"))
        if not api_key:
            raise RuntimeError("缺少 GEMINI_API_KEY 或 ONEAPI_API_KEY。")
        if not base_url:
            raise RuntimeError("缺少 GEMINI_BASE_URL 或 ONEAPI_BASE_URL。")
        return cls(
            api_key=api_key,
            base_url=base_url,
            default_model=default_model,
            timeout_seconds=timeout_seconds,
        )

    @property
    def chat_completions_url(self) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"


class GeminiGatewayClient:
    def __init__(self, config: LLMConfig) -> None:
        self.config = config

    def chat(
        self,
        messages: Sequence[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.4,
    ) -> str:
        payload = {
            "model": model or self.config.default_model,
            "messages": list(messages),
            "temperature": temperature,
        }
        data = json.dumps(payload).encode("utf-8")
        http_request = request.Request(
            self.config.chat_completions_url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.api_key}",
            },
            method="POST",
        )
        try:
            with request.urlopen(http_request, timeout=self.config.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"模型请求失败: HTTP {exc.code} {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"模型请求失败: {exc.reason}") from exc

        try:
            return str(body["choices"][0]["message"]["content"]).strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"模型响应格式异常: {body}") from exc


class StandaloneRunner:
    def __init__(
        self,
        project: SeedanceProject,
        runtime: RuntimeStore,
        llm_client: GeminiGatewayClient,
    ) -> None:
        self.project = project
        self.runtime = runtime
        self.llm_client = llm_client

    def run_status(self) -> int:
        return print_status(self.project)

    def run_start(
        self,
        episode_arg: str | None,
        *,
        style: str | None,
        medium: str | None,
        force: bool,
        max_review_rounds: int,
    ) -> int:
        episode = self.project.resolve_episode(episode_arg)
        self.runtime.ensure_episode(episode)
        output_path = self.project.director_output_for(episode)
        if output_path.exists() and not force:
            raise RuntimeError(f"{output_path.name} 已存在。使用 --force 才会覆盖。")

        script_path = self.project.script_for_episode(episode)
        style_value = style or self._ask_or_require("视觉风格", "例如: 真人写实 / 国漫 / 日漫")
        medium_value = medium or self._ask_or_require("目标媒介", "例如: 短剧 / 漫剧 / 广告")

        current = self._generate_director_analysis(episode, script_path, style_value, medium_value)
        self.project.write_text(output_path, current)
        current, reviews = self._review_and_revise_director(
            episode,
            script_path,
            current,
            style_value,
            medium_value,
            max_review_rounds=max_review_rounds,
        )
        self.project.write_text(output_path, current)

        print(f"导演分析已完成并写入: {output_path}")
        for review in reviews:
            print(f"- {review.name}: {'PASS' if review.passed else 'FAIL'}")
        return 0

    def run_design(
        self,
        episode_arg: str | None,
        *,
        force: bool,
        max_review_rounds: int,
    ) -> int:
        episode = self.project.resolve_episode(episode_arg)
        self.runtime.ensure_episode(episode)

        director_output = self.project.director_output_for(episode)
        if not director_output.exists():
            raise RuntimeError(f"请先完成 {episode} 的导演分析。")

        character_exists = self.project.has_episode_tag(self.project.character_prompts_path, episode)
        scene_exists = self.project.has_episode_tag(self.project.scene_prompts_path, episode)
        if (character_exists or scene_exists) and not force:
            raise RuntimeError(
                f"检测到 {episode} 的服化道内容已写入 assets。使用 --force 才会重新生成。"
            )

        character_content, scene_content = self._generate_art_design(episode, director_output)
        character_content, scene_content, reviews = self._review_and_revise_art_design(
            episode,
            director_output,
            character_content,
            scene_content,
            max_review_rounds=max_review_rounds,
        )
        self._write_asset_content(
            self.project.character_prompts_path,
            "人物提示词",
            character_content,
            replace_episode=episode if force else None,
        )
        self._write_asset_content(
            self.project.scene_prompts_path,
            "场景道具提示词",
            scene_content,
            replace_episode=episode if force else None,
        )

        print(f"服化道设计已完成并写入: {self.project.character_prompts_path}")
        print(f"服化道设计已完成并写入: {self.project.scene_prompts_path}")
        for review in reviews:
            print(f"- {review.name}: {'PASS' if review.passed else 'FAIL'}")
        return 0

    def run_prompt(
        self,
        episode_arg: str | None,
        *,
        force: bool,
        max_review_rounds: int,
    ) -> int:
        episode = self.project.resolve_episode(episode_arg)
        self.runtime.ensure_episode(episode)

        director_output = self.project.director_output_for(episode)
        prompt_output = self.project.prompt_output_for(episode)
        if not director_output.exists():
            raise RuntimeError(f"请先完成 {episode} 的导演分析。")
        if not self.project.character_prompts_path.exists() or not self.project.scene_prompts_path.exists():
            raise RuntimeError("缺少 assets/character-prompts.md 或 assets/scene-prompts.md。")
        if prompt_output.exists() and not force:
            raise RuntimeError(f"{prompt_output.name} 已存在。使用 --force 才会覆盖。")

        current = self._generate_storyboard_prompts(episode, director_output)
        self.project.write_text(prompt_output, current)
        current, reviews = self._review_and_revise_storyboard(
            episode,
            director_output,
            current,
            max_review_rounds=max_review_rounds,
        )
        self.project.write_text(prompt_output, current)

        print(f"Seedance 提示词已完成并写入: {prompt_output}")
        for review in reviews:
            print(f"- {review.name}: {'PASS' if review.passed else 'FAIL'}")
        return 0

    def _generate_director_analysis(
        self,
        episode: str,
        script_path: Path,
        style: str,
        medium: str,
    ) -> str:
        prompt = "\n\n".join(
            [
                f"任务: 为 {episode} 生成完整的 outputs/{episode}/01-director-analysis.md。",
                "你必须只输出最终 markdown 文件内容，不要解释，不要加代码块。",
                f"视觉风格: {style}",
                f"目标媒介: {medium}",
                self._labeled_block("剧本文件", self.project.read_text(script_path)),
                self._optional_block("已有人物提示词", self.project.read_text(self.project.character_prompts_path)),
                self._optional_block("已有场景提示词", self.project.read_text(self.project.scene_prompts_path)),
            ]
        )
        return self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "director-skill",
            ],
            prompt,
        ).strip()

    def _review_and_revise_director(
        self,
        episode: str,
        script_path: Path,
        current: str,
        style: str,
        medium: str,
        *,
        max_review_rounds: int,
    ) -> tuple[str, list[ReviewResult]]:
        reviews: list[ReviewResult] = []
        for _ in range(max_review_rounds + 1):
            business = self._review_director_business(episode, script_path, current)
            compliance = self._review_director_compliance(episode, current)
            reviews = [business, compliance]
            if all(review.passed for review in reviews):
                return current, reviews
            current = self._revise_director_analysis(
                episode,
                script_path,
                current,
                style,
                medium,
                reviews,
            )
        raise RuntimeError("导演分析在最大审核轮次后仍未通过。")

    def _review_director_business(self, episode: str, script_path: Path, current: str) -> ReviewResult:
        prompt = "\n\n".join(
            [
                f"现在执行 {episode} 的 script-analysis-review-skill 业务审核。",
                "你必须只输出审核结果。",
                self._labeled_block("原始剧本", self.project.read_text(script_path)),
                self._labeled_block("待审核的导演分析", current),
            ]
        )
        text = self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "script-analysis-review-skill",
            ],
            prompt,
        )
        return ReviewResult("业务审核", bool(BUSINESS_PASS_PATTERN.search(text)), text)

    def _review_director_compliance(self, episode: str, current: str) -> ReviewResult:
        prompt = "\n\n".join(
            [
                f"现在执行 {episode} 的 compliance-review-skill 合规审核。",
                "你必须只输出审核结果。",
                self._labeled_block("待审核的导演分析", current),
            ]
        )
        text = self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "compliance-review-skill",
            ],
            prompt,
        )
        return ReviewResult("合规审核", bool(COMPLIANCE_PASS_PATTERN.search(text)), text)

    def _revise_director_analysis(
        self,
        episode: str,
        script_path: Path,
        current: str,
        style: str,
        medium: str,
        reviews: Sequence[ReviewResult],
    ) -> str:
        feedback = "\n\n".join(f"[{review.name}]\n{review.text}" for review in reviews)
        prompt = "\n\n".join(
            [
                f"根据以下全部审核意见，一次性修订 {episode} 的 01-director-analysis.md。",
                "你必须只输出修订后的完整 markdown 文件内容，不要解释，不要加代码块。",
                f"视觉风格: {style}",
                f"目标媒介: {medium}",
                self._labeled_block("原始剧本", self.project.read_text(script_path)),
                self._labeled_block("当前导演分析", current),
                self._labeled_block("审核意见", feedback),
            ]
        )
        return self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "director-skill",
            ],
            prompt,
        ).strip()

    def _generate_art_design(self, episode: str, director_output: Path) -> tuple[str, str]:
        prompt = "\n\n".join(
            [
                f"任务: 为 {episode} 生成本集新增的服化道内容。",
                "严格按以下格式输出，不要额外文字:",
                "<<<CHARACTER_PROMPTS>>>\n[仅需要追加到 assets/character-prompts.md 的 markdown 内容，不要重复文件标题]",
                "<<<SCENE_PROMPTS>>>\n[仅需要追加到 assets/scene-prompts.md 的 markdown 内容，不要重复文件标题]",
                self._labeled_block("导演分析", self.project.read_text(director_output)),
                self._optional_block("已有人物提示词", self.project.read_text(self.project.character_prompts_path)),
                self._optional_block("已有场景提示词", self.project.read_text(self.project.scene_prompts_path)),
            ]
        )
        response = self._call_agent(
            "art-designer",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["art-designer"],
                self.project.root / "skills" / "art-design-skill",
            ],
            prompt,
        )
        return self._parse_art_sections(response)

    def _review_and_revise_art_design(
        self,
        episode: str,
        director_output: Path,
        character_content: str,
        scene_content: str,
        *,
        max_review_rounds: int,
    ) -> tuple[str, str, list[ReviewResult]]:
        reviews: list[ReviewResult] = []
        current_character = character_content
        current_scene = scene_content
        for _ in range(max_review_rounds + 1):
            business = self._review_art_business(episode, director_output, current_character, current_scene)
            compliance = self._review_art_compliance(episode, current_character, current_scene)
            reviews = [business, compliance]
            if all(review.passed for review in reviews):
                return current_character, current_scene, reviews
            current_character, current_scene = self._revise_art_design(
                episode,
                director_output,
                current_character,
                current_scene,
                reviews,
            )
        raise RuntimeError("服化道设计在最大审核轮次后仍未通过。")

    def _review_art_business(
        self,
        episode: str,
        director_output: Path,
        character_content: str,
        scene_content: str,
    ) -> ReviewResult:
        prompt = "\n\n".join(
            [
                f"现在执行 {episode} 的 art-direction-review-skill 业务审核。",
                "你必须只输出审核结果。",
                self._labeled_block("导演分析", self.project.read_text(director_output)),
                self._optional_block("已有人物提示词", self.project.read_text(self.project.character_prompts_path)),
                self._optional_block("已有场景提示词", self.project.read_text(self.project.scene_prompts_path)),
                self._labeled_block("本集新增人物提示词", character_content),
                self._labeled_block("本集新增场景提示词", scene_content),
            ]
        )
        text = self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "art-direction-review-skill",
            ],
            prompt,
        )
        return ReviewResult("业务审核", bool(BUSINESS_PASS_PATTERN.search(text)), text)

    def _review_art_compliance(
        self,
        episode: str,
        character_content: str,
        scene_content: str,
    ) -> ReviewResult:
        prompt = "\n\n".join(
            [
                f"现在执行 {episode} 的 compliance-review-skill 合规审核。",
                "你必须只输出审核结果。",
                self._labeled_block("本集新增人物提示词", character_content),
                self._labeled_block("本集新增场景提示词", scene_content),
            ]
        )
        text = self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "compliance-review-skill",
            ],
            prompt,
        )
        return ReviewResult("合规审核", bool(COMPLIANCE_PASS_PATTERN.search(text)), text)

    def _revise_art_design(
        self,
        episode: str,
        director_output: Path,
        character_content: str,
        scene_content: str,
        reviews: Sequence[ReviewResult],
    ) -> tuple[str, str]:
        feedback = "\n\n".join(f"[{review.name}]\n{review.text}" for review in reviews)
        prompt = "\n\n".join(
            [
                f"根据以下全部审核意见，一次性修订 {episode} 的服化道新增内容。",
                "严格按以下格式输出，不要额外文字:",
                "<<<CHARACTER_PROMPTS>>>\n[仅需要追加到 assets/character-prompts.md 的 markdown 内容，不要重复文件标题]",
                "<<<SCENE_PROMPTS>>>\n[仅需要追加到 assets/scene-prompts.md 的 markdown 内容，不要重复文件标题]",
                self._labeled_block("导演分析", self.project.read_text(director_output)),
                self._labeled_block("当前人物提示词新增内容", character_content),
                self._labeled_block("当前场景提示词新增内容", scene_content),
                self._labeled_block("审核意见", feedback),
            ]
        )
        response = self._call_agent(
            "art-designer",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["art-designer"],
                self.project.root / "skills" / "art-design-skill",
            ],
            prompt,
        )
        return self._parse_art_sections(response)

    def _generate_storyboard_prompts(self, episode: str, director_output: Path) -> str:
        prompt = "\n\n".join(
            [
                f"任务: 为 {episode} 生成完整的 outputs/{episode}/02-seedance-prompts.md。",
                "你必须只输出最终 markdown 文件内容，不要解释，不要加代码块。",
                self._labeled_block("导演分析", self.project.read_text(director_output)),
                self._labeled_block("人物提示词", self.project.read_text(self.project.character_prompts_path)),
                self._labeled_block("场景提示词", self.project.read_text(self.project.scene_prompts_path)),
            ]
        )
        return self._call_agent(
            "storyboard-artist",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["storyboard-artist"],
                self.project.root / "skills" / "seedance-storyboard-skill",
            ],
            prompt,
        ).strip()

    def _review_and_revise_storyboard(
        self,
        episode: str,
        director_output: Path,
        current: str,
        *,
        max_review_rounds: int,
    ) -> tuple[str, list[ReviewResult]]:
        reviews: list[ReviewResult] = []
        for _ in range(max_review_rounds + 1):
            business = self._review_storyboard_business(episode, director_output, current)
            compliance = self._review_storyboard_compliance(episode, current)
            reviews = [business, compliance]
            if all(review.passed for review in reviews):
                return current, reviews
            current = self._revise_storyboard_prompts(episode, director_output, current, reviews)
        raise RuntimeError("分镜提示词在最大审核轮次后仍未通过。")

    def _review_storyboard_business(
        self,
        episode: str,
        director_output: Path,
        current: str,
    ) -> ReviewResult:
        prompt = "\n\n".join(
            [
                f"现在执行 {episode} 的 seedance-prompt-review-skill 业务审核。",
                "你必须只输出审核结果。",
                self._labeled_block("导演分析", self.project.read_text(director_output)),
                self._labeled_block("人物提示词", self.project.read_text(self.project.character_prompts_path)),
                self._labeled_block("场景提示词", self.project.read_text(self.project.scene_prompts_path)),
                self._labeled_block("待审核的 Seedance 提示词", current),
            ]
        )
        text = self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "seedance-prompt-review-skill",
            ],
            prompt,
        )
        return ReviewResult("业务审核", bool(BUSINESS_PASS_PATTERN.search(text)), text)

    def _review_storyboard_compliance(self, episode: str, current: str) -> ReviewResult:
        prompt = "\n\n".join(
            [
                f"现在执行 {episode} 的 compliance-review-skill 合规审核。",
                "你必须只输出审核结果。",
                self._labeled_block("待审核的 Seedance 提示词", current),
            ]
        )
        text = self._call_agent(
            "director",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["director"],
                self.project.root / "skills" / "compliance-review-skill",
            ],
            prompt,
        )
        return ReviewResult("合规审核", bool(COMPLIANCE_PASS_PATTERN.search(text)), text)

    def _revise_storyboard_prompts(
        self,
        episode: str,
        director_output: Path,
        current: str,
        reviews: Sequence[ReviewResult],
    ) -> str:
        feedback = "\n\n".join(f"[{review.name}]\n{review.text}" for review in reviews)
        prompt = "\n\n".join(
            [
                f"根据以下全部审核意见，一次性修订 {episode} 的 02-seedance-prompts.md。",
                "你必须只输出修订后的完整 markdown 文件内容，不要解释，不要加代码块。",
                self._labeled_block("导演分析", self.project.read_text(director_output)),
                self._labeled_block("人物提示词", self.project.read_text(self.project.character_prompts_path)),
                self._labeled_block("场景提示词", self.project.read_text(self.project.scene_prompts_path)),
                self._labeled_block("当前 Seedance 提示词", current),
                self._labeled_block("审核意见", feedback),
            ]
        )
        return self._call_agent(
            "storyboard-artist",
            episode,
            [
                self.project.root / AGENT_FILE_MAP["storyboard-artist"],
                self.project.root / "skills" / "seedance-storyboard-skill",
            ],
            prompt,
        ).strip()

    def _call_agent(
        self,
        agent_name: str,
        episode: str,
        docs: Sequence[Path],
        user_prompt: str,
        *,
        temperature: float = 0.4,
    ) -> str:
        session = self.runtime.load_session(agent_name, episode)
        system_prompt = self._build_system_prompt(agent_name, docs)
        messages = [{"role": "system", "content": system_prompt}, *session.messages, {"role": "user", "content": user_prompt}]
        model = self._model_for(agent_name)
        response = self.llm_client.chat(messages, model=model, temperature=temperature)
        session.messages.extend(
            [
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": response},
            ]
        )
        self.runtime.save_session(session)
        return response

    def _build_system_prompt(self, agent_name: str, docs: Sequence[Path]) -> str:
        preface = (
            f"你正在被一个独立的本地程序调用，当前角色是 {agent_name}。"
            "严格遵守后续文档中的角色定义、技能规则和模板要求。"
            "除非用户提示里明确要求解释，否则只输出最终需要写入文件或审核结果的内容。"
        )
        return f"{preface}\n\n{self._collect_docs(docs)}"

    def _collect_docs(self, docs: Sequence[Path]) -> str:
        parts: list[str] = []
        for doc in docs:
            if doc.is_dir():
                files = sorted(path for path in doc.rglob("*.md") if path.is_file())
            else:
                files = [doc]
            for path in files:
                relative = path.relative_to(self.project.root)
                parts.append(f"===== {relative} =====\n{path.read_text(encoding='utf-8')}")
        return "\n\n".join(parts)

    def _parse_art_sections(self, response: str) -> tuple[str, str]:
        match = SECTION_PATTERN.search(response)
        if not match:
            raise RuntimeError("服化道输出未按约定的双区块格式返回。")
        character_content = self._normalize_asset_content(match.group(1), "人物提示词")
        scene_content = self._normalize_asset_content(match.group(2), "场景道具提示词")
        return character_content, scene_content

    def _normalize_asset_content(self, content: str, header: str) -> str:
        normalized = content.strip()
        normalized = re.sub(rf"^#\s*{re.escape(header)}\s*", "", normalized)
        normalized = re.sub(r"^---\s*", "", normalized)
        return normalized.strip()

    def _write_asset_content(
        self,
        path: Path,
        title: str,
        content: str,
        *,
        replace_episode: str | None,
    ) -> None:
        content = content.strip()
        if not content:
            return
        existing = self.project.read_text(path)
        if replace_episode:
            existing = self._remove_episode_sections(existing, replace_episode)

        if not existing.strip():
            merged = f"# {title}\n\n---\n\n{content}\n"
        else:
            merged = existing.rstrip() + "\n\n---\n\n" + content + "\n"
        self.project.write_text(path, merged)

    def _remove_episode_sections(self, content: str, episode: str) -> str:
        if not content.strip():
            return content
        chunks = [chunk.strip() for chunk in re.split(r"\n\s*---\s*\n", content) if chunk.strip()]
        kept: list[str] = []
        header_chunk = ""
        for index, chunk in enumerate(chunks):
            if index == 0 and chunk.startswith("# "):
                header_chunk = chunk
                continue
            if episode.lower() in chunk.lower():
                continue
            kept.append(chunk)
        rebuilt: list[str] = []
        if header_chunk:
            rebuilt.append(header_chunk)
        rebuilt.extend(kept)
        return "\n\n---\n\n".join(rebuilt).strip() + ("\n" if rebuilt else "")

    def _labeled_block(self, label: str, content: str) -> str:
        return f"<<<{label}>>>\n{content.strip()}\n<<<END_{label}>>>"

    def _optional_block(self, label: str, content: str) -> str:
        cleaned = content.strip()
        if not cleaned:
            return f"<<<{label}>>>\n(无)\n<<<END_{label}>>>"
        return self._labeled_block(label, cleaned)

    def _ask_or_require(self, label: str, hint: str) -> str:
        if sys.stdin.isatty():
            value = input(f"请输入{label}（{hint}）: ").strip()
            if value:
                return value
        raise RuntimeError(f"缺少 {label}。请通过命令行参数传入。")

    def _model_for(self, agent_name: str) -> str:
        env_map = {
            "director": "SEEDANCE_DIRECTOR_MODEL",
            "art-designer": "SEEDANCE_ART_MODEL",
            "storyboard-artist": "SEEDANCE_STORYBOARD_MODEL",
        }
        return os.getenv(env_map[agent_name]) or self.llm_client.config.default_model


def print_status(project: SeedanceProject) -> int:
    statuses = project.get_episode_statuses()
    if not statuses:
        print("请先在 script/ 中放入剧本文件（.md 或 .txt），文件名建议包含 ep01 这类集数标识。")
        return 1

    current = choose_current_episode(statuses)
    agent_state = project.read_agent_state()

    print("项目进度检测")
    print()
    print("剧本文件:")
    for status in statuses:
        print(f"- {status.script_path.name} [{status.state_label}]")
    print()
    if current is not None:
        print(f"当前集数: {current.episode}")
        print(f"当前阶段: {current.current_stage}")
        print(f"Agent 状态: {format_agent_state(agent_state)}")
        print(f"下一步: {next_action(current.current_stage, current.episode)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="seedance.py",
        description="Standalone runner for the Seedance storyboard workflow.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status", help="Show project progress.")

    start_parser = subparsers.add_parser("start", help="Run director analysis.")
    start_parser.add_argument("episode", nargs="?", help="Episode like ep01")
    start_parser.add_argument("--style", help="Visual style")
    start_parser.add_argument("--medium", help="Target medium")
    start_parser.add_argument("--force", action="store_true", help="Overwrite existing output")
    start_parser.add_argument(
        "--max-review-rounds",
        type=int,
        default=2,
        help="Maximum revision rounds after failed reviews.",
    )

    design_parser = subparsers.add_parser("design", help="Run art design stage.")
    design_parser.add_argument("episode", nargs="?", help="Episode like ep01")
    design_parser.add_argument("--force", action="store_true", help="Replace existing episode assets")
    design_parser.add_argument(
        "--max-review-rounds",
        type=int,
        default=2,
        help="Maximum revision rounds after failed reviews.",
    )

    prompt_parser = subparsers.add_parser("prompt", help="Run storyboard prompt stage.")
    prompt_parser.add_argument("episode", nargs="?", help="Episode like ep01")
    prompt_parser.add_argument("--force", action="store_true", help="Overwrite existing prompt output")
    prompt_parser.add_argument(
        "--max-review-rounds",
        type=int,
        default=2,
        help="Maximum revision rounds after failed reviews.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    project = SeedanceProject(Path(__file__).resolve().parent)

    if args.command == "status":
        return print_status(project)

    try:
        llm_config = LLMConfig.from_env()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    runner = StandaloneRunner(project, RuntimeStore(project), GeminiGatewayClient(llm_config))
    try:
        if args.command == "start":
            return runner.run_start(
                args.episode,
                style=args.style,
                medium=args.medium,
                force=args.force,
                max_review_rounds=args.max_review_rounds,
            )
        if args.command == "design":
            return runner.run_design(
                args.episode,
                force=args.force,
                max_review_rounds=args.max_review_rounds,
            )
        if args.command == "prompt":
            return runner.run_prompt(
                args.episode,
                force=args.force,
                max_review_rounds=args.max_review_rounds,
            )
    except (RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())