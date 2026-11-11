from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding
from pypdf import PdfReader
from rank_bm25 import BM25Okapi

from app.models import PolicyChunk, PolicyDocumentSummary, RetrievalHit

_MD_HEADER_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
_PLAIN_HEADER_RE = re.compile(
    r"^(Article|Art\.?|Section|Sec\.?|Clause)\s+(\d+(?:\.\d+)?)\b(?:\s*[—–\-:]\s*(.*))?$",
    re.IGNORECASE,
)
_CLAUSE_EXTRACT_RE = re.compile(
    r"\b(Article|Art\.?|Section|Sec\.?|Clause)\s+(\d+(?:\.\d+)?)\b",
    re.IGNORECASE,
)
_CJK_KANA_RUN_RE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]+")
_DOTTED_NUM_RE = re.compile(r"\b\d+\.\d+\b")
_WORD_RE = re.compile(r"[a-z0-9]+")


def tokenize_multilingual(text: str) -> list[str]:
    """Tokenize English words, dotted clause IDs (e.g. 24.3, 27.2), and CJK/Kana bigrams."""
    if not text:
        return []
    low = text.lower()
    tokens: list[str] = []

    # Preserve dotted clause numbers explicitly (e.g. "24.3", "27.2")
    tokens.extend(_DOTTED_NUM_RE.findall(low))
    # Lowercase alphanumeric words
    tokens.extend(_WORD_RE.findall(low))

    # CJK & Hiragana/Katakana bigrams (plus unigrams for 1-char runs or short terms)
    for run in _CJK_KANA_RUN_RE.findall(text):
        if len(run) == 1:
            tokens.append(run)
        else:
            for i in range(len(run) - 1):
                tokens.append(run[i : i + 2])
    return tokens


def _canonical_prefix(raw_prefix: str) -> str:
    p = raw_prefix.strip().rstrip(".").lower()
    if p in {"art", "article"}:
        return "Article"
    if p in {"sec", "section"}:
        return "Section"
    return "Clause"


def _classify_category(clause_id: str, title: str, body: str) -> str:
    title_low = title.lower()
    body_low = body.lower()

    if any(k in title_low for k in ("sub-limit", "sublimit", "cap ")):
        return "sublimit"
    if any(
        k in title_low
        for k in ("exclusion", "non-covered", "not covered", "不保", "除外", "escalation", "強制轉介")
    ):
        return "exclusion"
    if any(k in title_low for k in ("definition", "名詞定義")):
        return "definition"
    if any(k in title_low for k in ("period of insurance", "保險期間", "general")):
        return "general"
    if any(
        k in title_low
        for k in (
            "coverage",
            "benefit",
            "reimbursement",
            "transportation",
            "curtailment",
            "loss of",
            "保險",
            "給付",
        )
    ):
        return "coverage"

    if any(k in body_low for k in ("sub-limit", "capped at a maximum")):
        return "sublimit"
    if any(k in body_low for k in ("no benefit shall be payable", "strictly excludes", "zero benefit")):
        return "exclusion"
    if any(k in body_low for k in ("insurer shall indemnify", "insurer shall reimburse", "insurer shall pay")):
        return "coverage"
    return "general"


class HybridPolicyRAG:
    """Section-aware Hybrid RAG (ONNX Dense Cosine + Clause/CJK BM25 + Bidirectional Cross-Ref Graph)."""

    def __init__(self, storage_dir: Path, model_name: str = "BAAI/bge-small-en-v1.5") -> None:
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.model_name = model_name

        self._store_path = self.storage_dir / "index_store.json"
        self._vectors_path = self.storage_dir / "index_vectors.npz"

        self._embedder: TextEmbedding | None = None
        self._documents: dict[str, PolicyDocumentSummary] = {}
        self._chunks: list[PolicyChunk] = []
        self._vectors: np.ndarray = np.zeros((0, 384), dtype=np.float32)
        self._bm25: BM25Okapi | None = None
        self._tokenized_corpus: list[list[str]] = []

        self._load_from_disk()

    def _get_embedder(self) -> TextEmbedding:
        if self._embedder is None:
            self._embedder = TextEmbedding(model_name=self.model_name)
        return self._embedder

    def _corpus_fingerprint(self, chunks: list[PolicyChunk]) -> str:
        hasher = hashlib.sha256()
        hasher.update(self.model_name.encode("utf-8"))
        for c in chunks:
            hasher.update(c.chunk_id.encode("utf-8"))
            hasher.update(c.text.encode("utf-8"))
        return hasher.hexdigest()

    def _rebuild_bm25(self) -> None:
        self._tokenized_corpus = [
            tokenize_multilingual(f"{c.clause_id} {c.title} {c.text}") for c in self._chunks
        ]
        if self._tokenized_corpus:
            self._bm25 = BM25Okapi(self._tokenized_corpus)
        else:
            self._bm25 = None

    def _load_from_disk(self) -> None:
        if not (self._store_path.exists() and self._vectors_path.exists()):
            return
        try:
            payload = json.loads(self._store_path.read_text(encoding="utf-8"))
            if payload.get("model_name") != self.model_name:
                return
            docs = [PolicyDocumentSummary.model_validate(d) for d in payload.get("documents", [])]
            chunks = [PolicyChunk.model_validate(c) for c in payload.get("chunks", [])]
            expected_fp = payload.get("fingerprint", "")
            if expected_fp != self._corpus_fingerprint(chunks):
                return

            with np.load(self._vectors_path) as npz:
                vectors = npz["vectors"].astype(np.float32)
            if vectors.shape[0] != len(chunks):
                return

            self._documents = {d.doc_id: d for d in docs}
            self._chunks = chunks
            self._vectors = vectors
            self._rebuild_bm25()
        except Exception:
            # Corrupted or outdated cache; clean re-index will overwrite
            self._documents = {}
            self._chunks = []
            self._vectors = np.zeros((0, 384), dtype=np.float32)
            self._bm25 = None

    def _save_to_disk(self) -> None:
        payload = {
            "model_name": self.model_name,
            "fingerprint": self._corpus_fingerprint(self._chunks),
            "documents": [d.model_dump() for d in self._documents.values()],
            "chunks": [c.model_dump() for c in self._chunks],
        }
        self._store_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        np.savez_compressed(self._vectors_path, vectors=self._vectors)

    def _embed_texts(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 384), dtype=np.float32)
        embedder = self._get_embedder()
        raw = np.vstack(list(embedder.embed(texts))).astype(np.float32)
        norms = np.linalg.norm(raw, axis=1, keepdims=True)
        norms = np.where(norms == 0.0, 1.0, norms)
        return raw / norms

    def _parse_sections(self, doc_id: str, doc_title: str, content: str) -> list[PolicyChunk]:
        lines = content.splitlines()
        raw_sections: list[dict[str, str]] = []

        current_clause_id: str | None = None
        current_parent: str = "General"
        current_title: str = ""
        current_lines: list[str] = []
        generic_idx = 0

        def flush() -> None:
            if current_clause_id is None:
                return
            body = "\n".join(current_lines).strip()
            body_without_rules = re.sub(r"^[-*_]{3,}\s*$", "", body, flags=re.MULTILINE).strip()
            # Skip empty container headers (e.g. "## Article 24" immediately followed by "### Section 24.1")
            if not body_without_rules:
                return
            raw_sections.append(
                {
                    "clause_id": current_clause_id,
                    "parent_article": current_parent,
                    "title": current_title,
                    "body": body_without_rules,
                }
            )

        for line in lines:
            stripped = line.strip()
            md_match = _MD_HEADER_RE.match(stripped)
            plain_match = None if md_match else _PLAIN_HEADER_RE.match(stripped)

            if md_match:
                hashes, heading_text = md_match.group(1), md_match.group(2).strip()
                # Top-level H1 is typically document title; don't start a clause unless it says Article/Section
                clause_m = _CLAUSE_EXTRACT_RE.search(heading_text)
                if len(hashes) == 1 and not clause_m:
                    continue

                flush()
                current_lines = []
                if clause_m:
                    prefix = _canonical_prefix(clause_m.group(1))
                    num = clause_m.group(2)
                    current_clause_id = f"{prefix} {num}"
                    current_parent = f"Article {num.split('.')[0]}"
                    # Clean title after dash/colon if present
                    after = heading_text[clause_m.end() :].lstrip(" —–-:")
                    current_title = after if after else heading_text
                else:
                    generic_idx += 1
                    current_clause_id = f"Section {generic_idx}"
                    current_parent = current_clause_id
                    current_title = heading_text
                continue

            if plain_match:
                flush()
                current_lines = []
                prefix = _canonical_prefix(plain_match.group(1))
                num = plain_match.group(2)
                rest = (plain_match.group(3) or "").strip()
                current_clause_id = f"{prefix} {num}"
                current_parent = f"Article {num.split('.')[0]}"
                current_title = rest if rest else current_clause_id
                continue

            if current_clause_id is not None:
                current_lines.append(line)

        flush()

        # Fallback if uploaded text/PDF had no recognizable headers
        if not raw_sections:
            paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
            merged: list[str] = []
            buf = ""
            for p in paragraphs:
                if len(buf) + len(p) < 900:
                    buf = f"{buf}\n\n{p}".strip() if buf else p
                else:
                    if buf:
                        merged.append(buf)
                    buf = p
            if buf:
                merged.append(buf)
            for idx, block in enumerate(merged or [content.strip()], start=1):
                if not block:
                    continue
                cid = f"Section {idx}"
                first_line = block.splitlines()[0][:80].strip("# ")
                raw_sections.append(
                    {
                        "clause_id": cid,
                        "parent_article": cid,
                        "title": first_line or f"{doc_title} — Part {idx}",
                        "body": block,
                    }
                )

        chunks: list[PolicyChunk] = []
        for idx, sec in enumerate(raw_sections, start=1):
            clause_id = sec["clause_id"]
            title = sec["title"]
            body = sec["body"]
            category = _classify_category(clause_id, title, body)
            slug = re.sub(r"[^a-z0-9]+", "_", clause_id.lower()).strip("_")
            chunk_id = f"{doc_id}__{slug}_{idx}"
            full_text = f"{clause_id} — {title}\n{body}" if title != clause_id else f"{clause_id}\n{body}"
            chunks.append(
                PolicyChunk(
                    chunk_id=chunk_id,
                    doc_id=doc_id,
                    doc_title=doc_title,
                    clause_id=clause_id,
                    parent_article=sec["parent_article"],
                    title=title,
                    category=category,  # type: ignore[arg-type]
                    text=full_text,
                    cross_refs=[],
                )
            )

        self._populate_cross_refs(chunks)
        return chunks

    @staticmethod
    def _clause_num(clause_id: str) -> str | None:
        m = re.search(r"(\d+(?:\.\d+)?)", clause_id)
        return m.group(1) if m else None

    def _populate_cross_refs(self, chunks: list[PolicyChunk]) -> None:
        num_to_clauses: dict[str, list[str]] = {}
        parent_to_children: dict[str, list[str]] = {}

        for c in chunks:
            num = self._clause_num(c.clause_id)
            if num:
                num_to_clauses.setdefault(num, []).append(c.clause_id)
            parent_num = self._clause_num(c.parent_article)
            if parent_num:
                parent_to_children.setdefault(parent_num, []).append(c.clause_id)

        for c in chunks:
            refs: list[str] = []
            # Skip matching the chunk's own header line
            body_lines = c.text.splitlines()[1:] if "\n" in c.text else [c.text]
            scan_text = "\n".join(body_lines)
            for match in _CLAUSE_EXTRACT_RE.finditer(scan_text):
                ref_num = match.group(2)
                targets = num_to_clauses.get(ref_num, [])
                if not targets and ref_num in parent_to_children:
                    targets = parent_to_children[ref_num]
                for target_cid in targets:
                    if target_cid != c.clause_id and target_cid not in refs:
                        refs.append(target_cid)
            c.cross_refs = refs

    @staticmethod
    def _count_graph_edges(chunks: list[PolicyChunk]) -> int:
        edges: set[tuple[str, str]] = set()
        for a in chunks:
            for ref in a.cross_refs:
                edges.add((a.clause_id, ref))
                edges.add((ref, a.clause_id))
            for b in chunks:
                if (
                    a.clause_id != b.clause_id
                    and a.parent_article == b.parent_article
                    and b.category in {"exclusion", "sublimit"}
                ):
                    edges.add((a.clause_id, b.clause_id))
        return len(edges)

    def ingest_markdown_or_text(
        self,
        doc_id: str,
        title: str,
        filename: str,
        content: str,
    ) -> PolicyDocumentSummary:
        new_chunks = self._parse_sections(doc_id=doc_id, doc_title=title, content=content)
        embed_inputs = [f"{c.clause_id}: {c.title}\n{c.text}" for c in new_chunks]
        new_vecs = self._embed_texts(embed_inputs)

        # Remove prior version of doc_id if re-ingested
        if doc_id in self._documents:
            keep_indices = [i for i, c in enumerate(self._chunks) if c.doc_id != doc_id]
            self._chunks = [self._chunks[i] for i in keep_indices]
            if len(keep_indices) > 0 and self._vectors.shape[0] > 0:
                self._vectors = self._vectors[keep_indices]
            else:
                self._vectors = np.zeros((0, 384), dtype=np.float32)

        if self._vectors.shape[0] == 0:
            self._vectors = new_vecs
        elif new_vecs.shape[0] > 0:
            self._vectors = np.vstack([self._vectors, new_vecs])

        self._chunks.extend(new_chunks)
        summary = PolicyDocumentSummary(
            doc_id=doc_id,
            title=title,
            filename=filename,
            chunk_count=len(new_chunks),
            cross_ref_edges=self._count_graph_edges(new_chunks),
        )
        self._documents[doc_id] = summary
        self._rebuild_bm25()
        self._save_to_disk()
        return summary

    def ingest_pdf_bytes(
        self,
        doc_id: str,
        title: str,
        filename: str,
        pdf_bytes: bytes,
    ) -> PolicyDocumentSummary:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages_text = [page.extract_text() or "" for page in reader.pages]
        full_text = "\n\n".join(p for p in pages_text if p.strip())
        return self.ingest_markdown_or_text(
            doc_id=doc_id,
            title=title,
            filename=filename,
            content=full_text,
        )

    def list_documents(self) -> list[PolicyDocumentSummary]:
        return list(self._documents.values())

    def list_chunks(self, doc_id: str | None = None) -> list[PolicyChunk]:
        if doc_id is None:
            return list(self._chunks)
        return [c for c in self._chunks if c.doc_id == doc_id]

    def _is_graph_anchored_exclusion(self, idx: int) -> bool:
        chunk = self._chunks[idx]
        if chunk.category not in {"exclusion", "sublimit"}:
            return False
        for other in self._chunks:
            if other.doc_id != chunk.doc_id or other.chunk_id == chunk.chunk_id:
                continue
            if other.category == "coverage":
                if (
                    other.clause_id in chunk.cross_refs
                    or chunk.clause_id in other.cross_refs
                    or other.parent_article == chunk.parent_article
                ):
                    return True
        return False

    @staticmethod
    def _query_explicitly_targets_chunk(joined_query_low: str, chunk: PolicyChunk) -> bool:
        if any(
            kw in joined_query_low
            for kw in ("exclusion", "sublimit", "sub-limit", "不保", "除外")
        ):
            return True
        num = HybridPolicyRAG._clause_num(chunk.clause_id)
        if num:
            if "." in num and num in joined_query_low:
                return True
            if re.search(rf"\b(?:article|art\.?|section|sec\.?|clause)\s+{re.escape(num)}\b", joined_query_low):
                return True
        return False

    def search(
        self,
        queries: list[str] | str,
        top_k: int = 6,
        expand_cross_refs: bool = True,
    ) -> list[RetrievalHit]:
        if not self._chunks or self._vectors.shape[0] == 0:
            return []

        query_list = [queries] if isinstance(queries, str) else [q for q in queries if q and q.strip()]
        query_list = [q.strip() for q in query_list if q.strip()]
        if not query_list:
            return []

        n_chunks = len(self._chunks)
        q_vecs = self._embed_texts(query_list)
        # Shape: (num_queries, n_chunks)
        cos_matrix = np.clip(q_vecs @ self._vectors.T, -1.0, 1.0)

        bm25_matrix = np.zeros((len(query_list), n_chunks), dtype=np.float64)
        if self._bm25 is not None:
            for qi, q_str in enumerate(query_list):
                q_tokens = tokenize_multilingual(q_str)
                if q_tokens:
                    bm25_matrix[qi] = self._bm25.get_scores(q_tokens)

        # Reciprocal Rank Fusion (k=60) across all queries
        rrf_k = 60.0
        rrf_scores = np.zeros(n_chunks, dtype=np.float64)
        for qi in range(len(query_list)):
            cos_order = np.argsort(-cos_matrix[qi])
            bm25_order = np.argsort(-bm25_matrix[qi])

            for rank_idx, chunk_idx in enumerate(cos_order, start=1):
                rrf_scores[chunk_idx] += 1.0 / (rrf_k + rank_idx)

            # Only contribute BM25 rank signal when query has lexical overlap, else neutral rank
            if np.max(bm25_matrix[qi]) > 0:
                for rank_idx, chunk_idx in enumerate(bm25_order, start=1):
                    rrf_scores[chunk_idx] += 1.0 / (rrf_k + rank_idx)

        rrf_scores /= float(len(query_list))
        best_cosine = np.max(cos_matrix, axis=0)
        best_bm25 = np.max(bm25_matrix, axis=0)

        joined_q_low = " ".join(query_list).lower()

        # Primary candidate pool: coverage/definition/general provisions (plus standalone or explicitly queried exclusions)
        primary_indices = [
            i
            for i in range(n_chunks)
            if not self._is_graph_anchored_exclusion(i)
            or self._query_explicitly_targets_chunk(joined_q_low, self._chunks[i])
        ]
        if not primary_indices:
            primary_indices = list(range(n_chunks))

        primary_sorted = sorted(primary_indices, key=lambda i: (-rrf_scores[i], -best_cosine[i]))[: max(1, top_k)]

        hits: list[RetrievalHit] = []
        seen_chunk_ids: set[str] = set()

        for idx in primary_sorted:
            c = self._chunks[idx]
            seen_chunk_ids.add(c.chunk_id)
            hits.append(
                RetrievalHit(
                    chunk=c,
                    cosine_score=round(float(max(0.0, best_cosine[idx])), 4),
                    bm25_score=round(float(max(0.0, best_bm25[idx])), 4),
                    rrf_score=round(float(rrf_scores[idx]), 5),
                    retrieval_reason="hybrid_match",
                    linked_from=None,
                )
            )

        if not expand_cross_refs:
            return hits

        # Bidirectional + Sibling Cross-Reference Exclusion/Sublimit Graph Expansion
        # Expand from top-ranked primary anchors so unrelated tail hits don't pull off-topic exclusions
        anchor_limit = min(len(primary_sorted), 3)
        expanded_candidates: dict[int, str] = {}
        for anchor_idx in primary_sorted[:anchor_limit]:
            anchor = self._chunks[anchor_idx]
            for cand_idx, cand in enumerate(self._chunks):
                if cand.chunk_id in seen_chunk_ids or cand.doc_id != anchor.doc_id:
                    continue
                if cand_idx in expanded_candidates:
                    continue
                if cand.category not in {"exclusion", "sublimit"}:
                    continue

                outgoing_match = cand.clause_id in anchor.cross_refs
                incoming_exclusion = anchor.clause_id in cand.cross_refs
                sibling_exclusion = (
                    cand.parent_article == anchor.parent_article
                    and cand.parent_article != "General"
                )

                if outgoing_match or incoming_exclusion or sibling_exclusion:
                    expanded_candidates[cand_idx] = anchor.clause_id

        expanded_sorted = sorted(
            expanded_candidates.keys(),
            key=lambda i: (-rrf_scores[i], -best_cosine[i]),
        )

        for idx in expanded_sorted:
            c = self._chunks[idx]
            seen_chunk_ids.add(c.chunk_id)
            hits.append(
                RetrievalHit(
                    chunk=c,
                    cosine_score=round(float(max(0.0, best_cosine[idx])), 4),
                    bm25_score=round(float(max(0.0, best_bm25[idx])), 4),
                    rrf_score=round(float(rrf_scores[idx]), 5),
                    retrieval_reason="cross_ref_expansion",
                    linked_from=expanded_candidates[idx],
                )
            )

        return hits
