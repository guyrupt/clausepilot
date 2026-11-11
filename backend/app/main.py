from __future__ import annotations

import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.adjudicator import adjudicate_claim, analyze_claim
from app.gmi_client import REASONING_MODEL, VISION_MODEL, GMIClient
from app.models import (
    AdjudicateRequest,
    AnalyzeClaimResponse,
    ClaimCase,
    EvidenceFile,
    PolicyChunk,
    PolicyDocumentSummary,
    PolicySearchRequest,
    RetrievalHit,
    SettlementReport,
)
from app.rag import HybridPolicyRAG
from app.seed_data import ensure_seed_data

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
EVIDENCE_DIR = DATA_DIR / "evidence"
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


def _resolve_rag_storage_dir(data_dir: Path) -> Path:
    for candidate in (
        data_dir / "generated" / "rag_index",
        data_dir / "rag_index",
        data_dir / "generated",
        data_dir / "index",
        data_dir,
    ):
        if (candidate / "index_store.json").is_file():
            return candidate
    default_dir = data_dir / "generated" / "rag_index"
    default_dir.mkdir(parents=True, exist_ok=True)
    return default_dir


class AppState:
    def __init__(self) -> None:
        self.initialized: bool = False
        self.rag: HybridPolicyRAG | None = None
        self.gmi: GMIClient | None = None
        self.claims: dict[str, ClaimCase] = {}
        self.analyses: dict[str, AnalyzeClaimResponse] = {}

    def ensure_ready(self) -> None:
        if self.initialized and self.rag is not None and self.gmi is not None:
            return
        storage_dir = _resolve_rag_storage_dir(DATA_DIR)
        self.rag = HybridPolicyRAG(storage_dir=storage_dir, model_name="BAAI/bge-small-en-v1.5")
        self.gmi = GMIClient()
        seeded = ensure_seed_data(data_dir=DATA_DIR, rag=self.rag)
        self.claims = dict(seeded)
        self.initialized = True


state = AppState()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    state.ensure_ready()
    yield


app = FastAPI(
    title="ClausePilot API",
    description="Hybrid Cross-Reference Policy RAG + Guided Travel Claims Adjudication Engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static/evidence",
    StaticFiles(directory=str(EVIDENCE_DIR)),
    name="evidence",
)


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).name)
    return cleaned or "attachment.png"


@app.get("/api/health")
async def get_health() -> dict[str, object]:
    state.ensure_ready()
    assert state.rag is not None and state.gmi is not None
    return {
        "status": "ok",
        "embedding_model": "BAAI/bge-small-en-v1.5",
        "vision_model": VISION_MODEL,
        "reasoning_model": REASONING_MODEL,
        "chunk_count": len(state.rag.list_chunks()),
        "doc_count": len(state.rag.list_documents()),
        "gmi_configured": state.gmi.is_configured,
    }


@app.get("/api/policies")
async def get_policies() -> dict[str, list[PolicyDocumentSummary] | list[PolicyChunk]]:
    state.ensure_ready()
    assert state.rag is not None
    return {
        "documents": state.rag.list_documents(),
        "chunks": state.rag.list_chunks(),
    }


@app.post("/api/policies/upload", response_model=PolicyDocumentSummary)
async def upload_policy(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
) -> PolicyDocumentSummary:
    state.ensure_ready()
    assert state.rag is not None

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded policy file is empty.")

    filename = file.filename or "uploaded_policy.md"
    stem_title = Path(filename).stem.replace("_", " ").replace("-", " ").strip().title()
    resolved_title = (title or "").strip() or stem_title or "Uploaded Policy Document"
    doc_id = f"pol_{uuid.uuid4().hex[:8]}"

    if filename.lower().endswith(".pdf"):
        return state.rag.ingest_pdf_bytes(
            doc_id=doc_id,
            title=resolved_title,
            filename=filename,
            pdf_bytes=raw_bytes,
        )

    text_content = raw_bytes.decode("utf-8", errors="replace")
    return state.rag.ingest_markdown_or_text(
        doc_id=doc_id,
        title=resolved_title,
        filename=filename,
        content=text_content,
    )


@app.post("/api/policies/search")
async def search_policies(req: PolicySearchRequest) -> dict[str, list[RetrievalHit]]:
    state.ensure_ready()
    assert state.rag is not None
    query_str = req.query.strip()
    if not query_str:
        return {"hits": []}
    hits = state.rag.search(
        queries=query_str,
        top_k=req.top_k,
        expand_cross_refs=req.expand_cross_refs,
    )
    return {"hits": hits}


@app.get("/api/claims")
async def get_claims() -> dict[str, list[ClaimCase]]:
    state.ensure_ready()
    return {"claims": list(state.claims.values())}


@app.post("/api/claims/upload", response_model=ClaimCase)
async def upload_claim(
    title: str = Form(...),
    route: str = Form("TPE -> NRT"),
    narrative: str = Form(...),
    files: list[UploadFile] = File(default=[]),
) -> ClaimCase:
    state.ensure_ready()
    idx_num = 8900 + len(state.claims) + 1
    case_id = f"CLM-{idx_num}"
    while case_id in state.claims:
        idx_num += 1
        case_id = f"CLM-{idx_num}"

    evidence_files: list[EvidenceFile] = []
    for idx, up_file in enumerate(files, start=1):
        if not up_file.filename:
            continue
        content = await up_file.read()
        if not content:
            continue
        safe_name = f"{case_id.lower()}_{idx}_{_sanitize_filename(up_file.filename)}"
        target_path = EVIDENCE_DIR / safe_name
        target_path.write_bytes(content)
        evidence_files.append(
            EvidenceFile(
                filename=safe_name,
                label=Path(up_file.filename).stem.replace("_", " ").title(),
                url=f"/static/evidence/{safe_name}",
            )
        )

    delay_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)", narrative, flags=re.IGNORECASE)
    delay_hours = float(delay_match.group(1)) if delay_match else 6.0

    flight_match = re.search(r"\b([A-Z]{2}\d{2,4}[A-Z]?)\b", f"{title} {narrative}")
    flight_number = flight_match.group(1) if flight_match else "CUSTOM"

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    new_case = ClaimCase(
        case_id=case_id,
        title=title.strip() or f"Custom Claim {case_id}",
        subtitle=f"{route.strip()} · Uploaded Claim Packet",
        claimant_name="Walk-In Policyholder",
        route=route.strip() or "TPE -> NRT",
        flight_number=flight_number,
        policy_purchased_at="Verified Active Policy",
        incident_time=now_str,
        delay_hours=delay_hours,
        claim_type="custom",
        narrative=narrative.strip(),
        evidence_files=evidence_files,
        pre_extracted_items=[],
        badge="Custom Upload",
    )
    state.claims[case_id] = new_case
    return new_case


@app.post("/api/claims/{case_id}/analyze", response_model=AnalyzeClaimResponse)
async def analyze_claim_endpoint(
    case_id: str,
    force_ocr: bool = Query(default=False),
) -> AnalyzeClaimResponse:
    state.ensure_ready()
    assert state.rag is not None and state.gmi is not None

    case = state.claims.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Claim case '{case_id}' not found.")

    analysis = await analyze_claim(
        case=case,
        rag=state.rag,
        gmi=state.gmi,
        evidence_dir=EVIDENCE_DIR,
        force_ocr=force_ocr,
    )
    state.analyses[case_id] = analysis
    return analysis


@app.post("/api/claims/{case_id}/adjudicate", response_model=SettlementReport)
async def adjudicate_claim_endpoint(
    case_id: str,
    req: AdjudicateRequest,
) -> SettlementReport:
    state.ensure_ready()
    assert state.rag is not None and state.gmi is not None

    case = state.claims.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Claim case '{case_id}' not found.")

    analysis = state.analyses.get(case_id)
    if analysis is None:
        analysis = await analyze_claim(
            case=case,
            rag=state.rag,
            gmi=state.gmi,
            evidence_dir=EVIDENCE_DIR,
            force_ocr=False,
        )
        state.analyses[case_id] = analysis

    return await adjudicate_claim(
        case=case,
        analysis=analysis,
        answers=req.answers,
        gmi=state.gmi,
    )
