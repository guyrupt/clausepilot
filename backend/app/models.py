from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


def _coerce_float(val: Any) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        cleaned = val.replace(",", "").strip()
        if not cleaned or cleaned in {"-", "N/A", "n/a", "none", "None"}:
            return 0.0
        match = re.search(r"[-+]?\d*\.?\d+", cleaned)
        if match:
            return float(match.group(0))
    return float(val)


class PolicyChunk(BaseModel):
    chunk_id: str
    doc_id: str
    doc_title: str
    clause_id: str
    parent_article: str
    title: str
    category: Literal["coverage", "exclusion", "sublimit", "definition", "general"] = "general"
    text: str
    cross_refs: list[str] = Field(default_factory=list)

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v: Any) -> str:
        if not isinstance(v, str):
            return "general"
        low = v.strip().lower().replace("-", "").replace("_", "")
        mapping = {
            "coverage": "coverage",
            "coverages": "coverage",
            "benefit": "coverage",
            "benefits": "coverage",
            "exclusion": "exclusion",
            "exclusions": "exclusion",
            "sublimit": "sublimit",
            "sublimits": "sublimit",
            "cap": "sublimit",
            "limit": "sublimit",
            "definition": "definition",
            "definitions": "definition",
            "general": "general",
        }
        return mapping.get(low, "general")


class PolicyDocumentSummary(BaseModel):
    doc_id: str
    title: str
    filename: str
    chunk_count: int
    cross_ref_edges: int


class RetrievalHit(BaseModel):
    chunk: PolicyChunk
    cosine_score: float
    bm25_score: float
    rrf_score: float
    retrieval_reason: Literal["hybrid_match", "cross_ref_expansion"]
    linked_from: str | None = None

    @field_validator("cosine_score", "bm25_score", "rrf_score", mode="before")
    @classmethod
    def normalize_scores(cls, v: Any) -> float:
        return _coerce_float(v)


class EvidenceFile(BaseModel):
    filename: str
    label: str
    url: str


class ExtractedReceiptItem(BaseModel):
    item_id: str
    description: str
    category: str = "expense"
    original_amount: str = ""
    claimed_usd: float
    source_doc: str = ""

    @field_validator("claimed_usd", mode="before")
    @classmethod
    def normalize_claimed_usd(cls, v: Any) -> float:
        return _coerce_float(v)


class ClaimCase(BaseModel):
    case_id: str
    title: str
    subtitle: str
    claimant_name: str
    route: str
    flight_number: str
    policy_purchased_at: str
    incident_time: str
    delay_hours: float
    claim_type: Literal["flight_delay", "baggage_delay", "missed_connection", "custom"] = "custom"
    narrative: str
    evidence_files: list[EvidenceFile] = Field(default_factory=list)
    pre_extracted_items: list[ExtractedReceiptItem] = Field(default_factory=list)
    badge: str = ""

    @field_validator("delay_hours", mode="before")
    @classmethod
    def normalize_delay_hours(cls, v: Any) -> float:
        return _coerce_float(v)


class VerificationQuestion(BaseModel):
    id: str
    question: str
    clause_id: str
    why_it_matters: str
    options: list[str]
    suggested_answer: str
    evidence_hint: str = ""


class AnalyzeClaimResponse(BaseModel):
    case_id: str
    vision_summary: str
    vision_cached: bool = False
    extracted_items: list[ExtractedReceiptItem]
    queries_executed: list[str]
    retrieval_trace: list[RetrievalHit]
    questions: list[VerificationQuestion]
    naive_ai_estimate_usd: float
    naive_ai_flaw: str

    @field_validator("naive_ai_estimate_usd", mode="before")
    @classmethod
    def normalize_naive_estimate(cls, v: Any) -> float:
        return _coerce_float(v)


class AdjudicateRequest(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)


class LineItemDecision(BaseModel):
    item_id: str
    description: str
    claimed_usd: float
    approved_usd: float
    status: Literal["approved", "capped", "rejected", "escalate"]
    clause_id: str
    rationale: str

    @field_validator("claimed_usd", "approved_usd", mode="before")
    @classmethod
    def normalize_amounts(cls, v: Any) -> float:
        return _coerce_float(v)

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, v: Any) -> str:
        if not isinstance(v, str):
            return "rejected"
        low = v.strip().lower().replace("-", "_").replace(" ", "_")
        mapping = {
            "approved": "approved",
            "approve": "approved",
            "full": "approved",
            "paid": "approved",
            "covered": "approved",
            "allowed": "approved",
            "allow": "approved",
            "capped": "capped",
            "cap": "capped",
            "reduced": "capped",
            "partial": "capped",
            "partially_approved": "capped",
            "sublimit": "capped",
            "sub_limit": "capped",
            "limited": "capped",
            "rejected": "rejected",
            "reject": "rejected",
            "denied": "rejected",
            "deny": "rejected",
            "excluded": "rejected",
            "disallowed": "rejected",
            "ineligible": "rejected",
            "escalate": "escalate",
            "escalated": "escalate",
            "escalate_senior": "escalate",
            "hold": "escalate",
            "held": "escalate",
            "review": "escalate",
            "pending_review": "escalate",
        }
        return mapping.get(low, low)


class SettlementReport(BaseModel):
    case_id: str
    overall_outcome: Literal["approved", "partial", "denied", "escalate_senior"]
    total_claimed_usd: float
    total_approved_usd: float
    leakage_prevented_usd: float
    held_for_review_usd: float = 0.0
    line_items: list[LineItemDecision]
    escalation_reason: str | None = None
    executive_summary: str
    markdown_notice: str

    @field_validator(
        "total_claimed_usd",
        "total_approved_usd",
        "leakage_prevented_usd",
        "held_for_review_usd",
        mode="before",
    )
    @classmethod
    def normalize_totals(cls, v: Any) -> float:
        return _coerce_float(v)

    @field_validator("overall_outcome", mode="before")
    @classmethod
    def normalize_outcome(cls, v: Any) -> str:
        if not isinstance(v, str):
            return "denied"
        low = v.strip().lower().replace("-", "_").replace(" ", "_")
        mapping = {
            "approved": "approved",
            "full": "approved",
            "full_approval": "approved",
            "fully_approved": "approved",
            "partial": "partial",
            "partial_approval": "partial",
            "partially_approved": "partial",
            "capped": "partial",
            "reduced": "partial",
            "denied": "denied",
            "full_denial": "denied",
            "rejected": "denied",
            "excluded": "denied",
            "escalate_senior": "escalate_senior",
            "escalate": "escalate_senior",
            "escalated": "escalate_senior",
            "senior_escalation": "escalate_senior",
            "senior_review": "escalate_senior",
            "hold": "escalate_senior",
            "held": "escalate_senior",
        }
        return mapping.get(low, low)


class PolicySearchRequest(BaseModel):
    query: str
    top_k: int = 6
    expand_cross_refs: bool = True
