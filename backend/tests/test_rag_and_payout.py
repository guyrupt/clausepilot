from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.adjudicator import post_process_settlement  # noqa: E402
from app.main import DATA_DIR, app, state  # noqa: E402
from app.models import (  # noqa: E402
    AnalyzeClaimResponse,
    ClaimCase,
    ExtractedReceiptItem,
    PolicyChunk,
    RetrievalHit,
    VerificationQuestion,
)


def _clause_matches(clause_id: str, number_str: str) -> bool:
    return number_str in clause_id


def test_hybrid_rag_bidirectional_and_sibling_cross_refs() -> None:
    state.ensure_ready()
    assert state.rag is not None

    chunks = state.rag.list_chunks()
    assert len(chunks) >= 12, f"Expected >=12 policy chunks, got {len(chunks)}"

    # 1. Sibling + outgoing expansion: overnight hotel/meal flight delay query -> Section 24.3 & Article 22
    delay_hits = state.rag.search(
        queries=[
            "overnight hotel accommodation and meal expenses abroad during flight delay",
            "flight delay fixed benefit Shinjuku hotel 生ビール 定食",
        ],
        top_k=6,
        expand_cross_refs=True,
    )
    delay_clause_ids = [h.chunk.clause_id for h in delay_hits]
    assert any(_clause_matches(cid, "24.3") for cid in delay_clause_ids), (
        f"Expected Section 24.3 sub-limit/alcohol exclusion in {delay_clause_ids}"
    )
    assert any(_clause_matches(cid, "22") for cid in delay_clause_ids), (
        f"Expected Article 22 flight delay exclusion in {delay_clause_ids}"
    )
    assert any(h.retrieval_reason == "cross_ref_expansion" for h in delay_hits), (
        "Expected at least one cross_ref_expansion hit in delay retrieval trace"
    )

    # 2. Bidirectional backward expansion: baggage delay coverage (Art. 26) -> Art. 27.2 home-country exclusion
    baggage_hits = state.rag.search(
        queries="delayed baggage emergency clothing and toiletries reimbursement",
        top_k=5,
        expand_cross_refs=True,
    )
    baggage_clause_ids = [h.chunk.clause_id for h in baggage_hits]
    assert any(_clause_matches(cid, "26") for cid in baggage_clause_ids), (
        f"Expected Article 26 coverage in {baggage_clause_ids}"
    )
    assert any(_clause_matches(cid, "27.2") for cid in baggage_clause_ids), (
        f"Expected Article/Section 27.2 home-country arrival exclusion in {baggage_clause_ids}"
    )


def _dummy_hit(clause_id: str, category: str = "coverage") -> RetrievalHit:
    return RetrievalHit(
        chunk=PolicyChunk(
            chunk_id=f"chk_{clause_id}",
            doc_id="pacific_shield_2026",
            doc_title="PacificShield Travel Policy",
            clause_id=clause_id,
            parent_article=clause_id.split(".")[0].replace("Section", "Article"),
            title=f"Provision {clause_id}",
            category=category,
            text=f"Policy provision {clause_id}",
            cross_refs=[],
        ),
        cosine_score=0.82,
        bm25_score=6.4,
        rrf_score=0.032,
        retrieval_reason="hybrid_match",
    )


def test_deterministic_payout_post_processor_invariants() -> None:
    # Case A: Partial payout on CLM-8841 ($567 claimed -> $455 approved, $112 leakage prevented)
    items_8841 = [
        ExtractedReceiptItem(
            item_id="i1",
            description="Flight Delay Fixed Benefit (6h+)",
            category="fixed_benefit",
            original_amount="USD $250.00",
            claimed_usd=250.0,
        ),
        ExtractedReceiptItem(
            item_id="i2",
            description="Shinjuku Prince Hotel (1 night)",
            category="lodging",
            original_amount="¥36,000 / USD $240.00",
            claimed_usd=240.0,
        ),
        ExtractedReceiptItem(
            item_id="i3",
            description="Izakaya Set Dinner 定食",
            category="meal",
            original_amount="¥8,250 / USD $55.00",
            claimed_usd=55.0,
        ),
        ExtractedReceiptItem(
            item_id="i4",
            description="Draft Beer 生ビール x2",
            category="alcohol",
            original_amount="¥3,300 / USD $22.00",
            claimed_usd=22.0,
        ),
    ]
    case_8841 = ClaimCase(
        case_id="CLM-8841",
        title="Typhoon Delay",
        subtitle="NRT -> TPE",
        claimant_name="Lin Wei-Ting",
        route="NRT -> TPE",
        flight_number="JX805",
        policy_purchased_at="2026-10-25 14:10",
        incident_time="2026-10-29 20:15",
        delay_hours=6.42,
        claim_type="flight_delay",
        narrative="Delayed overnight in Tokyo.",
        pre_extracted_items=items_8841,
    )
    analysis_8841 = AnalyzeClaimResponse(
        case_id="CLM-8841",
        vision_summary="Starlux JX805 delayed 6h25m.",
        vision_cached=True,
        extracted_items=items_8841,
        queries_executed=["q1", "q2", "q3"],
        retrieval_trace=[
            _dummy_hit("Article 21", "coverage"),
            _dummy_hit("Section 24.1", "coverage"),
            _dummy_hit("Section 24.3", "sublimit"),
        ],
        questions=[
            VerificationQuestion(
                id="q1",
                question="Was typhoon announced after policy purchase?",
                clause_id="Article 22",
                why_it_matters="Pre-existing cutoff",
                options=["Yes", "No"],
                suggested_answer="Yes",
            )
        ],
        naive_ai_estimate_usd=567.0,
        naive_ai_flaw="Naive RAG misses Section 24.3 sub-limits.",
    )
    raw_partial = {
        "overall_outcome": "partial",
        "executive_summary": "Approved fixed tier and meal; capped hotel at $150; rejected alcohol.",
        "decisions_by_item": {
            "i1": {
                "approved_usd": "$299.00",  # Intentionally > claimed to verify clamping to $250!
                "status": "approved",
                "clause_id": "Article 21",
                "rationale": "Eligible 6h+ delay.",
            },
            "i2": {
                "approved_usd": 150.0,
                "status": "capped",
                "clause_id": "24.3",
                "rationale": "Capped at $150/night.",
            },
            "i3": {
                "approved_usd": 55.0,
                "status": "approved",
                "clause_id": "Section 24.1",
                "rationale": "Reasonable meal.",
            },
            "i4": {
                "approved_usd": 0.0,
                "status": "rejected",
                "clause_id": "Section 24.3",
                "rationale": "Alcohol excluded.",
            },
        },
    }
    report_partial = post_process_settlement(
        case_8841, analysis_8841, {"q1": "Yes"}, raw_partial
    )
    assert report_partial.overall_outcome == "partial"
    assert report_partial.total_claimed_usd == 567.0
    assert report_partial.total_approved_usd == 455.0
    assert report_partial.leakage_prevented_usd == 112.0
    assert report_partial.held_for_review_usd == 0.0
    assert [li.status for li in report_partial.line_items] == [
        "approved",
        "capped",
        "approved",
        "rejected",
    ]
    assert report_partial.line_items[1].clause_id == "Section 24.3"

    # Case B: Full denial ($340 -> $0, forces non-zero LLM leak to $0)
    items_8842 = [
        ExtractedReceiptItem(
            item_id="b1",
            description="Uniqlo Emergency Clothing & Toiletries",
            category="baggage_essentials",
            original_amount="NT$10,880 / USD $340.00",
            claimed_usd=340.0,
        )
    ]
    analysis_8842 = analysis_8841.model_copy(
        update={
            "case_id": "CLM-8842",
            "extracted_items": items_8842,
            "naive_ai_estimate_usd": 340.0,
            "retrieval_trace": [_dummy_hit("Article 27.2", "exclusion")],
        }
    )
    case_8842 = case_8841.model_copy(update={"case_id": "CLM-8842"})
    report_denied = post_process_settlement(
        case_8842,
        analysis_8842,
        {"q1": "Home country arrival"},
        {
            "overall_outcome": "denied",
            "executive_summary": "Inbound home-airport baggage excluded under Article 27.2.",
            "decisions_by_item": {
                "b1": {
                    "approved_usd": 340.0,  # Should be forced to 0.0 on denied!
                    "status": "approved",
                    "clause_id": "27.2",
                    "rationale": "Inbound TPE home airport exclusion.",
                }
            },
        },
    )
    assert report_denied.overall_outcome == "denied"
    assert report_denied.total_approved_usd == 0.0
    assert report_denied.leakage_prevented_usd == 340.0
    assert report_denied.held_for_review_usd == 0.0
    assert report_denied.line_items[0].status == "rejected"

    # Case C: Senior escalation ($1,420 held for review, $0 clerk payout, $0 leakage prevented)
    items_8843 = [
        ExtractedReceiptItem(
            item_id="m1",
            description="Walk-up Cathay Pacific LHR Rebooking",
            category="rebooking",
            original_amount="USD $1,420.00",
            claimed_usd=1420.0,
        )
    ]
    analysis_8843 = analysis_8841.model_copy(
        update={
            "case_id": "CLM-8843",
            "extracted_items": items_8843,
            "naive_ai_estimate_usd": 1420.0,
            "retrieval_trace": [_dummy_hit("Section 21.4", "exclusion")],
        }
    )
    case_8843 = case_8841.model_copy(update={"case_id": "CLM-8843"})
    report_esc = post_process_settlement(
        case_8843,
        analysis_8843,
        {"q1": "Separate PNRs"},
        {
            "overall_outcome": "escalate_senior",
            "escalation_reason": "Two separate PNRs (7K9X2A and M4P81Q) trigger Section 21.4 Senior Adjuster review.",
            "executive_summary": "Held for Senior Licensed Adjuster under Section 21.4.",
            "decisions_by_item": {
                "m1": {
                    "approved_usd": 1420.0,  # Should be forced to 0.0 on escalate_senior!
                    "status": "escalate",
                    "clause_id": "21.4",
                    "rationale": "Separate ticket conjunction review required.",
                }
            },
        },
    )
    assert report_esc.overall_outcome == "escalate_senior"
    assert report_esc.total_claimed_usd == 1420.0
    assert report_esc.total_approved_usd == 0.0
    assert report_esc.held_for_review_usd == 1420.0
    assert report_esc.leakage_prevented_usd == 0.0
    assert report_esc.line_items[0].status == "escalate"
    assert report_esc.escalation_reason is not None


def test_live_end_to_end_api_and_prewarm_vision_cache() -> None:
    with TestClient(app) as client:
        # 1. Health check & static evidence serving
        health = client.get("/api/health")
        assert health.status_code == 200
        h_body = health.json()
        assert h_body["status"] == "ok"
        assert h_body["gmi_configured"] is True
        assert h_body["chunk_count"] >= 12

        claims_resp = client.get("/api/claims")
        assert claims_resp.status_code == 200
        claims_list = claims_resp.json()["claims"]
        case_ids = {c["case_id"] for c in claims_list}
        assert {"CLM-8841", "CLM-8842", "CLM-8843"}.issubset(case_ids)

        static_resp = client.get("/static/evidence/clm_8841_receipt.png")
        assert static_resp.status_code == 200
        assert "image/png" in static_resp.headers.get("content-type", "")
        assert len(static_resp.content) > 1000

        # 2. Pre-warm Gemini 3.8 Flash Vision cache & verify Phase 1 + Phase 2 across all 3 seeded Taipei cases
        # --- CLM-8841: Hero Partial Approval ($567 -> $455, $112 leakage prevented) ---
        an_8841_resp = client.post("/api/claims/CLM-8841/analyze")
        assert an_8841_resp.status_code == 200
        an_8841 = an_8841_resp.json()
        assert len(an_8841["extracted_items"]) == 4
        assert round(sum(i["claimed_usd"] for i in an_8841["extracted_items"]), 2) == 567.0
        assert 2 <= len(an_8841["questions"]) <= 4
        assert any(
            h["retrieval_reason"] == "cross_ref_expansion" for h in an_8841["retrieval_trace"]
        )

        answers_8841 = {
            q["id"]: q["suggested_answer"] for q in an_8841["questions"]
        }
        adj_8841_resp = client.post(
            "/api/claims/CLM-8841/adjudicate", json={"answers": answers_8841}
        )
        assert adj_8841_resp.status_code == 200
        adj_8841 = adj_8841_resp.json()
        assert adj_8841["overall_outcome"] == "partial"
        assert adj_8841["total_claimed_usd"] == 567.0
        assert adj_8841["total_approved_usd"] == 455.0
        assert adj_8841["leakage_prevented_usd"] == 112.0

        # --- CLM-8842: Inbound Home-Country Arrival Baggage Denial ($340 -> $0) ---
        an_8842_resp = client.post("/api/claims/CLM-8842/analyze")
        assert an_8842_resp.status_code == 200
        an_8842 = an_8842_resp.json()
        answers_8842 = {
            q["id"]: q["suggested_answer"] for q in an_8842["questions"]
        }
        adj_8842_resp = client.post(
            "/api/claims/CLM-8842/adjudicate", json={"answers": answers_8842}
        )
        assert adj_8842_resp.status_code == 200
        adj_8842 = adj_8842_resp.json()
        assert adj_8842["overall_outcome"] == "denied"
        assert adj_8842["total_claimed_usd"] == 340.0
        assert adj_8842["total_approved_usd"] == 0.0
        assert "27.2" in adj_8842["markdown_notice"]

        # --- CLM-8843: Split-PNR Missed Connection Senior Escalation ($1,420 held) ---
        an_8843_resp = client.post("/api/claims/CLM-8843/analyze")
        assert an_8843_resp.status_code == 200
        an_8843 = an_8843_resp.json()
        answers_8843 = {
            q["id"]: q["suggested_answer"] for q in an_8843["questions"]
        }
        adj_8843_resp = client.post(
            "/api/claims/CLM-8843/adjudicate", json={"answers": answers_8843}
        )
        assert adj_8843_resp.status_code == 200
        adj_8843 = adj_8843_resp.json()
        assert adj_8843["overall_outcome"] == "escalate_senior"
        assert adj_8843["total_approved_usd"] == 0.0
        assert adj_8843["held_for_review_usd"] == 1420.0

        # Confirm vision_cache.json is persisted on disk and cached re-run hits cache
        cache_file = DATA_DIR / "vision_cache.json"
        assert cache_file.is_file()
        cached_check = client.post("/api/claims/CLM-8841/analyze").json()
        assert cached_check["vision_cached"] is True
