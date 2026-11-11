from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

import httpx

GMI_API_URL = "https://api.gmi-serving.com/v1/chat/completions"
VISION_MODEL = "google/gemini-3.8-flash"
REASONING_MODEL = "deepseek-ai/deepseek-v4.1-flash-1017"
VISION_PROMPT_VERSION = "clausepilot-vision-v1.1"


def _load_api_key(env_path: Path | None = None) -> str:
    env_val = os.environ.get("GMI_API_KEY", "").strip()
    if env_val:
        return env_val

    candidates = [
        env_path,
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parent.parent.parent / ".env",
    ]
    for path in candidates:
        if path and path.is_file():
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export ") :].strip()
                key, _, value = line.partition("=")
                if key.strip() == "GMI_API_KEY":
                    cleaned = value.strip().strip("'").strip('"')
                    if cleaned:
                        return cleaned
    return ""


def _strip_json_fences(raw_text: str) -> str:
    text = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fence_match:
        text = fence_match.group(1).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]
    return text


def _parse_json_object(raw_text: str) -> dict[str, Any]:
    cleaned = _strip_json_fences(raw_text)
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError(f"Expected JSON object from GMI model, got {type(parsed).__name__}")
    return parsed


def _mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    return "image/png"


class GMIClient:
    """Async GMI Cloud client for Gemini 3.8 Flash Vision + DeepSeek V4.1 Flash JSON."""

    def __init__(
        self,
        api_key: str | None = None,
        cache_path: Path | None = None,
        env_path: Path | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else _load_api_key(env_path)).strip()
        self.cache_path = cache_path or (
            Path(__file__).resolve().parent.parent / "data" / "vision_cache.json"
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise RuntimeError(
                "GMI_API_KEY is not configured. Add GMI_API_KEY to backend/.env or environment."
            )
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _compute_vision_cache_key(self, valid_paths: list[Path]) -> str:
        hasher = hashlib.sha256()
        hasher.update(VISION_PROMPT_VERSION.encode("utf-8"))
        for path in valid_paths:
            hasher.update(b"|FILE:")
            hasher.update(path.name.encode("utf-8"))
            hasher.update(b"|BYTES:")
            hasher.update(path.read_bytes())
        return hasher.hexdigest()

    def _read_cache_store(self) -> dict[str, Any]:
        if not self.cache_path.is_file():
            return {}
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _write_cache_entry(self, key: str, value: dict[str, Any]) -> None:
        store = self._read_cache_store()
        store[key] = value
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.cache_path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.cache_path)

    async def extract_evidence_vision(
        self,
        image_paths: list[Path],
        force_refresh: bool = False,
    ) -> tuple[dict[str, Any], bool]:
        valid_paths = [Path(p) for p in image_paths if Path(p).is_file()]
        if not valid_paths:
            return (
                {
                    "vision_summary": "No receipt or certificate images attached; relying on written claim narrative.",
                    "items": [],
                },
                True,
            )

        cache_key = self._compute_vision_cache_key(valid_paths)
        if not force_refresh:
            store = self._read_cache_store()
            cached_val = store.get(cache_key)
            if isinstance(cached_val, dict) and "vision_summary" in cached_val:
                return cached_val, True

        system_prompt = (
            "You are a precision multilingual (English, Traditional Chinese, Japanese) insurance "
            "document & receipt OCR specialist. Read every attached image carefully and return ONLY "
            "a single valid JSON object with NO markdown prose."
        )
        instruction_text = (
            "Extract all factual evidence and individual claimed expense line items across all attached "
            "claim documents. Do NOT include subtotal/grand-total summary rows as separate items.\n"
            "Return strictly this JSON structure:\n"
            "{\n"
            '  "vision_summary": "2-4 sentences summarizing airline/merchant, flight numbers, route, PNR codes, timestamps (policy purchase, weather warning, scheduled vs actual flight), delay duration/cause, and itemized charges.",\n'
            '  "items": [\n'
            "    {\n"
            '      "item_id": "vis_1",\n'
            '      "description": "Concise item description preserving key CJK/Japanese terms (e.g. Draft Beer 生ビール x2)",\n'
            '      "category": "fixed_benefit | lodging | meal | alcohol | baggage_essentials | rebooking | expense",\n'
            '      "original_amount": "Original currency string printed on receipt (e.g. ¥36,000 or NT$10,880 or USD $240.00)",\n'
            '      "claimed_usd": 240.0,\n'
            '      "source_doc": "exact_filename.png"\n'
            "    }\n"
            "  ]\n"
            "}"
        )

        user_content: list[dict[str, Any]] = [{"type": "text", "text": instruction_text}]
        for idx, img_path in enumerate(valid_paths, start=1):
            mime = _mime_for_path(img_path)
            b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
            user_content.append(
                {"type": "text", "text": f"Attachment #{idx} filename: {img_path.name}"}
            )
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                }
            )

        # IMPORTANT: Never include `reasoning_effort` for google/gemini-3.8-flash (causes HTTP 400).
        payload: dict[str, Any] = {
            "model": VISION_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": 4096,
            "temperature": 0.1,
        }

        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(45.0, connect=10.0)
                ) as client:
                    resp = await client.post(
                        GMI_API_URL, headers=self._headers(), json=payload
                    )
                    resp.raise_for_status()
                    body = resp.json()

                raw_content = body["choices"][0]["message"]["content"]
                if isinstance(raw_content, list):
                    raw_content = "".join(
                        part.get("text", "") if isinstance(part, dict) else str(part)
                        for part in raw_content
                    )
                parsed = _parse_json_object(str(raw_content))
                raw_items = parsed.get("items")
                normalized_items: list[dict[str, Any]] = []
                if isinstance(raw_items, list):
                    for idx, item in enumerate(raw_items, start=1):
                        if not isinstance(item, dict):
                            continue
                        normalized_items.append(
                            {
                                "item_id": str(item.get("item_id") or f"vis_{idx}"),
                                "description": str(item.get("description") or f"Receipt Item {idx}"),
                                "category": str(item.get("category") or "expense"),
                                "original_amount": str(item.get("original_amount") or ""),
                                "claimed_usd": item.get("claimed_usd", 0.0),
                                "source_doc": str(
                                    item.get("source_doc") or valid_paths[0].name
                                ),
                            }
                        )
                result = {
                    "vision_summary": str(
                        parsed.get("vision_summary")
                        or "Extracted structured evidence from claim attachments."
                    ).strip(),
                    "items": normalized_items,
                }
                self._write_cache_entry(cache_key, result)
                return result, False
            except Exception as exc:
                last_exc = exc
                if attempt == 0:
                    await asyncio.sleep(0.5)

        raise RuntimeError(f"Gemini 3.8 Flash Vision call failed: {last_exc}") from last_exc

    async def fast_json_completion(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": REASONING_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "reasoning_effort": "none",
            "response_format": {"type": "json_object"},
            "max_tokens": 2048,
            "temperature": 0.1,
        }

        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0, connect=10.0)
                ) as client:
                    resp = await client.post(
                        GMI_API_URL, headers=self._headers(), json=payload
                    )
                    resp.raise_for_status()
                    body = resp.json()

                raw_content = body["choices"][0]["message"]["content"]
                return _parse_json_object(str(raw_content))
            except Exception as exc:
                last_exc = exc
                if attempt == 0:
                    await asyncio.sleep(0.4)

        raise RuntimeError(f"DeepSeek V4.1 Flash JSON call failed: {last_exc}") from last_exc
