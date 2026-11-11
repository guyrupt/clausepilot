from __future__ import annotations

import json
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.gmi_client import GMIClient
from app.models import (
    AnalyzeClaimResponse,
    ClaimCase,
    ExtractedReceiptItem,
    LineItemDecision,
    RetrievalHit,
    SettlementReport,
    VerificationQuestion,
    _coerce_float,
)

if TYPE_CHECKING:
    from app.rag import HybridPolicyRAG


def _resolve_clause_id(raw_clause_id: str, retrieval_trace: list[RetrievalHit]) -> str:
    candidate = (raw_clause_id or "").strip().strip("[]")
    if not retrieval_trace:
        return candidate or "Policy General"

    known_ids = [hit.chunk.clause_id for hit in retrieval_trace if hit.chunk.clause_id]
    if not candidate:
        return known_ids[0]

    for kid in known_ids:
        if kid.lower() == candidate.lower():
            return kid

    num_match = re.search(r"(\d+(?:\.\d+)?)", candidate)
    if num_match:
        num_token = num_match.group(1)
        exact_num_matches = [
            kid
            for kid in known_ids
            if re.search(rf"(?<!\d){re.escape(num_token)}(?!\d|\.\d)", kid)
        ]
        if exact_num_matches:
            return exact_num_matches[0]

    return candidate


def _extract_fallback_items_from_narrative(case: ClaimCase) -> list[ExtractedReceiptItem]:
    matches = re.findall(r"(?:USD\s*)?\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)", case.narrative)
    if matches:
        items: list[ExtractedReceiptItem] = []
        for idx, raw_amt in enumerate(matches[:6], start=1):
            amt = _coerce_float(raw_amt)
            if amt > 0:
                items.append(
                    ExtractedReceiptItem(
                        item_id=f"nar_{idx}",
                        description=f"Claimed Expense #{idx} ({case.title})",
                        category="expense",
                        original_amount=f"USD ${amt:,.2f}",
                        claimed_usd=round(amt, 2),
                        source_doc="narrative",
                    )
                )
        if items:
            return items

    return [
        ExtractedReceiptItem(
            item_id="nar_1",
            description=f"Claimed Travel Inconvenience Benefit ({case.title})",
            category="expense",
            original_amount="USD $0.00",
            claimed_usd=0.0,
            source_doc="narrative",
        )
    ]


def build_deterministic_queries(
    case: ClaimCase,
    items: list[ExtractedReceiptItem],
    vision_summary: str,
) -> list[str]:
    """Deterministically build 3 targeted hybrid RAG queries in <1ms without LLM latency.

    Intentionally avoids injecting meta-words like 'exclusion' or 'sub-limit' so coverage
    clauses are retrieved as primary `hybrid_match` hits while exclusions and sub-limits
    are surfaced cleanly with `retrieval_reason='cross_ref_expansion'` badges.
    """
    route_clean = case.route.replace("->", " ").replace("→", " ")

    if case.claim_type == "flight_delay":
        q1 = (
            f"flight delay fixed benefit overnight stranded outside home country "
            f"necessary hotel accommodation meal reimbursement {route_clean} {case.delay_hours} hours"
        )
    elif case.claim_type == "baggage_delay":
        q1 = (
            f"baggage delay emergency essential clothing toiletries reimbursement "
            f"arrival airport {route_clean} {case.delay_hours} hours"
        )
    elif case.claim_type == "missed_connection":
        q1 = (
            f"missed flight connection rebooking coverage conjunction ticket single PNR "
            f"transit hub {route_clean}"
        )
    else:
        raw_snippet = re.sub(
            r"\b(exclusions?|sub-?limits?)\b", "", case.narrative[:180], flags=re.IGNORECASE
        )
        q1 = f"travel inconvenience coverage benefits {case.title} {route_clean} {raw_snippet}".strip()

    item_terms = " ".join(f"{it.category} {it.description}" for it in items).strip()
    q2 = (
        f"{item_terms} receipted hotel lodging per night restaurant meal "
        f"draft beer alcoholic beverages clothing rebooking"
    ).strip()

    combined_text = f"{case.narrative} {vision_summary}".lower()
    fact_signals: list[str] = []
    if any(k in combined_text for k in ("typhoon", "weather", "storm", "warning", "strike")):
        fact_signals.append(
            "publicly announced typhoon weather warning timestamp policy purchase automatic weather extension"
        )
    if any(k in combined_text for k in ("replacement", "next available", "rebook", "jx805d")):
        fact_signals.append("first available replacement recovery flight offered by carrier")
    if any(k in combined_text for k in ("home", "return", "tpe", "taipei", "baggage", "luggage")):
        fact_signals.append("home country return leg arrival Taipei Taoyuan TPE airport")
    if any(k in combined_text for k in ("pnr", "separate", "connection", "ticket")):
        fact_signals.append("single PNR conjunction ticket two separate tickets self-transfer")
    if not fact_signals:
        fact_signals.append("period of insurance currency conversion definitions policy scope")

    clean_narrative = re.sub(
        r"\b(exclusions?|sub-?limits?)\b", "", case.narrative[:140], flags=re.IGNORECASE
    ).strip()
    q3 = f"{' '.join(fact_signals)} {clean_narrative}".strip()
    return [q1, q2, q3]


def _format_clauses_for_prompt(retrieval_trace: list[RetrievalHit]) -> str:
    blocks: list[str] = []
    for idx, hit in enumerate(retrieval_trace, start=1):
        c = hit.chunk
        origin = (
            f"AUTO-LINKED EXCLUSION/SUBLIMIT from {hit.linked_from}"
            if hit.retrieval_reason == "cross_ref_expansion" and hit.linked_from
            else "HYBRID MATCH"
        )
        blocks.append(
            f"{idx}. [{c.clause_id}] {c.title} (category={c.category}, source={origin})\n"
            f"   Text: {c.text}"
        )
    return "\n\n".join(blocks)


def _normalize_questions(
    raw_questions: Any,
    retrieval_trace: list[RetrievalHit],
) -> list[VerificationQuestion]:
    questions: list[VerificationQuestion] = []
    if isinstance(raw_questions, list):
        for idx, rq in enumerate(raw_questions[:4], start=1):
            if not isinstance(rq, dict):
                continue
            q_text = str(rq.get("question") or "").strip()
            if not q_text:
                continue
            raw_opts = rq.get("options")
            options = (
                [str(o).strip() for o in raw_opts if str(o).strip()]
                if isinstance(raw_opts, list)
                else []
            )
            if len(options) < 2:
                options = [
                    "Confirmed — verified against claim documents",
                    "Not satisfied — policy exclusion or discrepancy applies",
                ]

            suggested = str(rq.get("suggested_answer") or "").strip()
            if suggested not in options:
                matched_opt = next(
                    (o for o in options if o.lower() == suggested.lower()),
                    None,
                )
                if matched_opt is None and suggested:
                    matched_opt = next(
                        (
                            o
                            for o in options
                            if suggested.lower() in o.lower() or o.lower() in suggested.lower()
                        ),
                        None,
                    )
                suggested = matched_opt if matched_opt is not None else options[0]

            clause_id = _resolve_clause_id(str(rq.get("clause_id") or ""), retrieval_trace)
            questions.append(
                VerificationQuestion(
                    id=str(rq.get("id") or f"q_{idx}"),
                    question=q_text,
                    clause_id=clause_id,
                    why_it_matters=str(
                        rq.get("why_it_matters")
                        or f"Determines eligibility or payout cap under {clause_id}."
                    ).strip(),
                    options=options,
                    suggested_answer=suggested,
                    evidence_hint=str(rq.get("evidence_hint") or "").strip(),
                )
            )

    if len(questions) < 2:
        default_clause = (
            retrieval_trace[0].chunk.clause_id if retrieval_trace else "Article 21"
        )
        questions.extend(
            [
                VerificationQuestion(
                    id="q_fallback_1",
                    question="Do the attachment timestamps confirm the incident occurred after policy purchase and meets the minimum delay threshold?",
                    clause_id=default_clause,
                    why_it_matters="Verifies baseline temporal eligibility and waiting-period threshold.",
                    options=[
                        "Yes — timestamps verified eligible",
                        "No — pre-existing event or below delay threshold",
                    ],
                    suggested_answer="Yes — timestamps verified eligible",
                    evidence_hint="Compare policy_purchased_at against incident_time and airline certificate.",
                ),
                VerificationQuestion(
                    id="q_fallback_2",
                    question="Do any cross-referenced policy exclusions, per-night caps, or separate-PNR escalation rules apply to the claimed items?",
                    clause_id=default_clause,
                    why_it_matters="Prevents overpayment on capped lodging, non-covered items, inbound home-airport claims, or split tickets.",
                    options=[
                        "Apply exact policy sub-limits, exclusions, or escalation rules per receipts",
                        "No exclusions or sub-limits triggered",
                    ],
                    suggested_answer="Apply exact policy sub-limits, exclusions, or escalation rules per receipts",
                    evidence_hint="Cross-check receipt line items, arrival airport, and PNR codes against retrieved exclusions.",
                ),
            ]
        )
        questions = questions[:4]

    return questions


async def analyze_claim(
    case: ClaimCase,
    rag: HybridPolicyRAG,
    gmi: GMIClient,
    evidence_dir: Path,
    force_ocr: bool = False,
) -> AnalyzeClaimResponse:
    """Phase 1: Vision OCR + Deterministic Multi-Query Hybrid RAG + Guided Clerk Checkpoints."""
    image_paths: list[Path] = []
    for ef in case.evidence_files:
        candidate = evidence_dir / ef.filename
        if candidate.is_file():
            image_paths.append(candidate)

    vision_data, vision_cached = await gmi.extract_evidence_vision(
        image_paths, force_refresh=force_ocr
    )
    vision_summary = str(vision_data.get("vision_summary") or "").strip()

    # Preserve canonical claimed items on seeded claims (e.g., Fixed Delay tier + exact receipt items)
    # while using pure Vision-extracted items on custom uploaded claims.
    if case.pre_extracted_items:
        extracted_items = [it.model_copy(deep=True) for it in case.pre_extracted_items]
    else:
        raw_vis_items = vision_data.get("items") or []
        extracted_items = [
            ExtractedReceiptItem.model_validate(raw_it)
            for raw_it in raw_vis_items
            if isinstance(raw_it, dict)
        ]
        if not extracted_items:
            extracted_items = _extract_fallback_items_from_narrative(case)

    queries_executed = build_deterministic_queries(case, extracted_items, vision_summary)
    retrieval_trace = rag.search(queries_executed, top_k=6, expand_cross_refs=True)

    total_claimed = round(sum(it.claimed_usd for it in extracted_items), 2)
    clauses_block = _format_clauses_for_prompt(retrieval_trace)
    items_json = json.dumps(
        [it.model_dump() for it in extracted_items], ensure_ascii=False, indent=2
    )

    system_prompt = (
        "You are a Senior Licensed Travel Insurance Adjuster building a guided verification "
        "checklist for a $15/hr claims clerk. You MUST ground every question in the retrieved "
        "policy clauses (especially auto-linked exclusions, sub-limits, home-country arrival "
        "exclusions, pre-existing weather cutoffs, and single-PNR conjunction ticket rules). "
        "Return ONLY valid JSON matching the requested schema."
    )

    user_prompt = (
        f"CLAIM METADATA:\n"
        f"- Case ID: {case.case_id}\n"
        f"- Title: {case.title}\n"
        f"- Route & Flight: {case.route} ({case.flight_number})\n"
        f"- Policy Purchased At: {case.policy_purchased_at}\n"
        f"- Incident Time: {case.incident_time}\n"
        f"- Delay Duration: {case.delay_hours} hours\n"
        f"- Claim Type: {case.claim_type}\n"
        f"- Claimant Narrative: {case.narrative}\n\n"
        f"GEMINI 3.8 VISION OCR SUMMARY:\n{vision_summary}\n\n"
        f"CLAIMED LINE ITEMS (Total Claimed = USD ${total_claimed:.2f}):\n{items_json}\n\n"
        f"RETRIEVED POLICY CLAUSES (HYBRID + CROSS-REFERENCE GRAPH):\n{clauses_block}\n\n"
        "TASK:\n"
        "Generate 3 (between 2 and 4) concise verification questions (1 short sentence each) for the clerk to confirm "
        "concrete factual checkpoints from the certificates/receipts before computing settlement.\n"
        "- Each `clause_id` MUST match one of the retrieved clause IDs in brackets above.\n"
        "- `options` MUST contain 2 concise choices (under 12 words each).\n"
        "- `suggested_answer` MUST be an EXACT copy of the option string supported by the Claim Metadata and Vision OCR Summary.\n"
        "- `evidence_hint` MUST be 1 short phrase citing specific dates/times, flight/PNR numbers, airports, or receipt amounts.\n"
        "- `naive_ai_estimate_usd` is the dollar amount a naive chat-with-PDF bot (which misses cross-referenced exclusions/sub-limits/PNR rules) would mistakenly approve (typically the full claimed total).\n"
        "- `naive_ai_flaw` explains in 1 crisp sentence which exact exclusion, sub-limit, or escalation clause naive cosine RAG misses.\n\n"
        "REQUIRED JSON SKELETON:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "id": "q1",\n'
        '      "question": "...",\n'
        '      "clause_id": "Section 24.3",\n'
        '      "why_it_matters": "...",\n'
        '      "options": ["Option A", "Option B"],\n'
        '      "suggested_answer": "Option A",\n'
        '      "evidence_hint": "..."\n'
        "    }\n"
        "  ],\n"
        f'  "naive_ai_estimate_usd": {total_claimed:.2f},\n'
        '  "naive_ai_flaw": "..."\n'
        "}"
    )

    llm_data = await gmi.fast_json_completion(system_prompt, user_prompt)
    questions = _normalize_questions(llm_data.get("questions"), retrieval_trace)

    raw_naive = _coerce_float(llm_data.get("naive_ai_estimate_usd", total_claimed))
    if raw_naive <= 0.0 and total_claimed > 0.0:
        naive_estimate = total_claimed
    else:
        naive_estimate = round(min(raw_naive, total_claimed), 2)

    naive_flaw = str(
        llm_data.get("naive_ai_flaw")
        or "Naive cosine top-K retrieval matches general coverage headers while missing cross-referenced sub-limits, exclusions, and separate-ticket escalation rules."
    ).strip()

    return AnalyzeClaimResponse(
        case_id=case.case_id,
        vision_summary=vision_summary,
        vision_cached=vision_cached,
        extracted_items=extracted_items,
        queries_executed=queries_executed,
        retrieval_trace=retrieval_trace,
        questions=questions,
        naive_ai_estimate_usd=naive_estimate,
        naive_ai_flaw=naive_flaw,
    )


def _build_markdown_notice(
    case: ClaimCase,
    analysis: AnalyzeClaimResponse,
    resolved_answers: dict[str, str],
    overall_outcome: str,
    total_claimed_usd: float,
    total_approved_usd: float,
    leakage_prevented_usd: float,
    held_for_review_usd: float,
    line_items: list[LineItemDecision],
    escalation_reason: str | None,
    executive_summary: str,
) -> str:
    outcome_labels = {
        "approved": "APPROVED IN FULL",
        "partial": "PARTIAL APPROVAL (SUB-LIMITS / EXCLUSIONS APPLIED)",
        "denied": "CLAIM DENIED",
        "escalate_senior": "ESCALATED TO SENIOR LICENSED ADJUSTER (PAYOUT HELD)",
    }
    banner = outcome_labels.get(overall_outcome, overall_outcome.upper())

    lines: list[str] = [
        f"# Official Settlement Decision Notice — `{case.case_id}`",
        "",
        f"- **Decision Outcome:** **{banner}**",
        f"- **Claimant:** {case.claimant_name}",
        f"- **Route & Flight:** {case.route} (`{case.flight_number}`)",
        f"- **Policy Purchased:** `{case.policy_purchased_at}` | **Incident Time:** `{case.incident_time}`",
        "",
        "## Executive Summary",
        executive_summary,
    ]

    if overall_outcome == "escalate_senior" and escalation_reason:
        lines.extend(
            [
                "",
                "## Senior Licensed Adjuster Handoff Brief",
                f"> {escalation_reason}",
            ]
        )

    lines.extend(["", "## Clerk Guided Verification Audit Log"])
    q_map = {q.id: q for q in analysis.questions}
    for qid, ans in resolved_answers.items():
        q_obj = q_map.get(qid)
        if q_obj:
            lines.append(f"- **[{q_obj.clause_id}]** {q_obj.question} → **{ans}**")
        else:
            lines.append(f"- **{qid}** → **{ans}**")

    lines.extend(
        [
            "",
            "## Line-by-Line Adjudication Schedule",
            "| Item Description | Claimed (USD) | Approved (USD) | Status | Policy Clause | Rationale |",
            "| :--- | ---: | ---: | :---: | :---: | :--- |",
        ]
    )
    for li in line_items:
        safe_desc = li.description.replace("|", "/")
        safe_rat = li.rationale.replace("|", "/").replace("\n", " ")
        lines.append(
            f"| {safe_desc} | ${li.claimed_usd:,.2f} | ${li.approved_usd:,.2f} | "
            f"`{li.status.upper()}` | `[{li.clause_id}]` | {safe_rat} |"
        )

    lines.extend(
        [
            "",
            "## Financial Settlement Summary",
            f"- **Total Claimed:** `${total_claimed_usd:,.2f}`",
            f"- **Total Approved Payout:** `${total_approved_usd:,.2f}`",
        ]
    )
    if overall_outcome == "escalate_senior":
        lines.append(
            f"- **Unverified Payout Held for Senior Review:** `${held_for_review_usd:,.2f}`"
        )
    else:
        lines.append(
            f"- **Overpayment Leakage Prevented (vs. Naive AI):** `${leakage_prevented_usd:,.2f}`"
        )

    cited_ids = []
    for li in line_items:
        if li.clause_id and li.clause_id not in cited_ids:
            cited_ids.append(li.clause_id)
    chunk_by_clause = {h.chunk.clause_id: h.chunk for h in analysis.retrieval_trace}
    if cited_ids:
        lines.extend(["", "## Cited Policy Provisions"])
        for cid in cited_ids:
            ch = chunk_by_clause.get(cid)
            if ch:
                lines.append(f"- **[{ch.clause_id}] {ch.title}** (*{ch.doc_title}*)")
            else:
                lines.append(f"- **[{cid}]**")

    return "\n".join(lines)


def post_process_settlement(
    case: ClaimCase,
    analysis: AnalyzeClaimResponse,
    resolved_answers: dict[str, str],
    raw_llm: dict[str, Any],
) -> SettlementReport:
    """Deterministic Python post-processor enforcing line-item integrity & payout invariants."""
    raw_outcome = SettlementReport.normalize_outcome(raw_llm.get("overall_outcome", "partial"))
    if raw_outcome not in {"approved", "partial", "denied", "escalate_senior"}:
        raw_outcome = "partial"

    decisions_map: dict[str, dict[str, Any]] = {}
    raw_by_item = raw_llm.get("decisions_by_item")
    if isinstance(raw_by_item, dict):
        for k, v in raw_by_item.items():
            if isinstance(v, dict):
                decisions_map[str(k)] = v

    raw_list = raw_llm.get("line_items")
    list_by_idx: list[dict[str, Any]] = []
    if isinstance(raw_list, list):
        for entry in raw_list:
            if isinstance(entry, dict):
                list_by_idx.append(entry)
                if entry.get("item_id") and str(entry["item_id"]) not in decisions_map:
                    decisions_map[str(entry["item_id"])] = entry

    line_items: list[LineItemDecision] = []
    for idx, canonical_item in enumerate(analysis.extracted_items):
        claimed = round(float(canonical_item.claimed_usd), 2)
        raw_dec = decisions_map.get(canonical_item.item_id)
        if raw_dec is None and idx < len(list_by_idx):
            raw_dec = list_by_idx[idx]
        raw_dec = raw_dec or {}

        clause_id = _resolve_clause_id(
            str(raw_dec.get("clause_id") or ""), analysis.retrieval_trace
        )
        rationale = str(
            raw_dec.get("rationale")
            or f"Adjudicated against retrieved policy clause {clause_id}."
        ).strip()

        if raw_outcome == "denied":
            approved = 0.0
            status = "rejected"
        elif raw_outcome == "escalate_senior":
            approved = 0.0
            status = "escalate"
        else:
            parsed_approved = _coerce_float(raw_dec.get("approved_usd", 0.0))
            raw_status = LineItemDecision.normalize_status(raw_dec.get("status", "rejected"))
            if raw_status == "rejected":
                parsed_approved = 0.0
            elif raw_status == "escalate":
                parsed_approved = 0.0

            approved = round(min(max(0.0, parsed_approved), claimed), 2)
            if approved == 0.0 and claimed > 0.0:
                status = "rejected"
            elif 0.0 < approved < claimed:
                status = "capped"
            else:
                status = "approved"

        line_items.append(
            LineItemDecision(
                item_id=canonical_item.item_id,
                description=canonical_item.description,
                claimed_usd=claimed,
                approved_usd=approved,
                status=status,
                clause_id=clause_id,
                rationale=rationale,
            )
        )

    total_claimed_usd = round(sum(li.claimed_usd for li in line_items), 2)
    total_approved_usd = round(sum(li.approved_usd for li in line_items), 2)

    if raw_outcome == "escalate_senior":
        overall_outcome = "escalate_senior"
    elif total_approved_usd == 0.0 and total_claimed_usd > 0.0:
        overall_outcome = "denied"
    elif 0.0 < total_approved_usd < total_claimed_usd:
        overall_outcome = "partial"
    else:
        overall_outcome = "approved"

    executive_summary = str(
        raw_llm.get("executive_summary")
        or f"Adjudicated claim {case.case_id} ({overall_outcome}): approved ${total_approved_usd:,.2f} of ${total_claimed_usd:,.2f} claimed."
    ).strip()

    raw_esc = raw_llm.get("escalation_reason")
    escalation_reason = (
        str(raw_esc).strip()
        if raw_esc and str(raw_esc).strip().lower() not in {"none", "null", "n/a"}
        else None
    )

    if overall_outcome == "escalate_senior":
        held_for_review_usd = total_claimed_usd
        leakage_prevented_usd = 0.0
        if not escalation_reason:
            escalation_reason = executive_summary
    else:
        held_for_review_usd = 0.0
        escalation_reason = None
        leakage_prevented_usd = round(
            max(0.0, max(total_claimed_usd, analysis.naive_ai_estimate_usd) - total_approved_usd),
            2,
        )

    markdown_notice = _build_markdown_notice(
        case=case,
        analysis=analysis,
        resolved_answers=resolved_answers,
        overall_outcome=overall_outcome,
        total_claimed_usd=total_claimed_usd,
        total_approved_usd=total_approved_usd,
        leakage_prevented_usd=leakage_prevented_usd,
        held_for_review_usd=held_for_review_usd,
        line_items=line_items,
        escalation_reason=escalation_reason,
        executive_summary=executive_summary,
    )

    return SettlementReport(
        case_id=case.case_id,
        overall_outcome=overall_outcome,
        total_claimed_usd=total_claimed_usd,
        total_approved_usd=total_approved_usd,
        leakage_prevented_usd=leakage_prevented_usd,
        held_for_review_usd=held_for_review_usd,
        line_items=line_items,
        escalation_reason=escalation_reason,
        executive_summary=executive_summary,
        markdown_notice=markdown_notice,
    )


async def adjudicate_claim(
    case: ClaimCase,
    analysis: AnalyzeClaimResponse,
    answers: dict[str, str],
    gmi: GMIClient,
) -> SettlementReport:
    """Phase 2: Clause-grounded per-item adjudication + Deterministic Python Payout Engine."""
    resolved_answers: dict[str, str] = {}
    for q in analysis.questions:
        ans = answers.get(q.id, "").strip()
        resolved_answers[q.id] = ans if ans else q.suggested_answer
    for extra_k, extra_v in answers.items():
        if extra_k not in resolved_answers and str(extra_v).strip():
            resolved_answers[extra_k] = str(extra_v).strip()

    clauses_block = _format_clauses_for_prompt(analysis.retrieval_trace)
    items_json = json.dumps(
        [it.model_dump() for it in analysis.extracted_items], ensure_ascii=False, indent=2
    )
    qa_lines: list[str] = []
    q_lookup = {q.id: q for q in analysis.questions}
    for qid, ans in resolved_answers.items():
        q_obj = q_lookup.get(qid)
        if q_obj:
            qa_lines.append(
                f"- [{q_obj.id} | {q_obj.clause_id}] {q_obj.question}\n  CLERK CONFIRMED ANSWER: {ans}"
            )
        else:
            qa_lines.append(f"- [{qid}] CLERK CONFIRMED ANSWER: {ans}")
    qa_block = "\n".join(qa_lines)

    system_prompt = (
        "You are a Senior Licensed Travel Insurance Claims Adjudicator. Adjudicate EVERY claimed "
        "line item strictly using the Retrieved Policy Clauses and the Clerk's Confirmed Answers.\n"
        "STRICT ADJUDICATION RULES:\n"
        "1. SENIOR ESCALATION (`escalate_senior`): If a policy clause requires escalation to a Senior "
        "Licensed Adjuster (e.g., missed connection booked across TWO separate tickets / separate PNRs "
        "under the Single-PNR Conjunction Ticket Rule, or unresolved coverage ambiguity) and the clerk "
        "answers confirm this, set `overall_outcome` to `\"escalate_senior\"`, write a comprehensive "
        "underwriter handoff brief in `escalation_reason` (citing flights, PNR codes, delay, and clause ID), "
        "and set EVERY item to `approved_usd: 0.0` and `status: \"escalate\"`.\n"
        "2. FULL DENIAL (`denied`): If a policy-wide exclusion disqualifies the claim (e.g., delayed baggage "
        "upon inbound arrival at Home Country airport under Article 27.2 / Section 27.2, OR weather/typhoon "
        "warning announced BEFORE policy purchase under Article 22 / Section 22.1, OR declining the first "
        "available replacement flight under Section 22.2) per the clerk's answers, set `overall_outcome` to "
        "`\"denied\"` and set EVERY item to `approved_usd: 0.0` and `status: \"rejected\"` citing that exact "
        "exclusion clause ID.\n"
        "3. CUMULATIVE COVERAGE & SUB-LIMITS (`approved` or `partial`): When Flight Delay Fixed Benefit "
        "(Article 21) and Overnight Delay Necessary Expenses Abroad (Section 24.1, stranded >6h overnight "
        "outside Home Country) apply cumulatively, evaluate each item individually:\n"
        "   - Approve eligible Fixed Flight Delay tier (e.g., $250.00 under Article 21).\n"
        "   - Cap hotel/lodging strictly at the policy per-night sub-limit (e.g., $150.00/night under Section 24.3 -> status `\"capped\"`).\n"
        "   - Approve reasonable necessary meals abroad (under Section 24.1 -> status `\"approved\"`).\n"
        "   - Strictly reject alcoholic beverages (e.g., Draft Beer / 生ビール), tobacco, or duty-free items ($0.00 under Section 24.3 -> status `\"rejected\"`).\n"
        "Return ONLY valid JSON matching the requested skeleton."
    )

    skeleton_items = {
        it.item_id: {
            "approved_usd": 0.0,
            "status": "approved | capped | rejected | escalate",
            "clause_id": "exact retrieved clause_id",
            "rationale": "1-sentence audit rationale citing clause rule and figures",
        }
        for it in analysis.extracted_items
    }

    user_prompt = (
        f"CLAIM METADATA:\n"
        f"- Case ID: {case.case_id}\n"
        f"- Title: {case.title}\n"
        f"- Route & Flight: {case.route} ({case.flight_number})\n"
        f"- Policy Purchased At: {case.policy_purchased_at}\n"
        f"- Incident Time: {case.incident_time}\n"
        f"- Delay Duration: {case.delay_hours} hours\n"
        f"- Narrative: {case.narrative}\n"
        f"- Vision OCR Summary: {analysis.vision_summary}\n\n"
        f"CANONICAL CLAIMED LINE ITEMS:\n{items_json}\n\n"
        f"CLERK CONFIRMED VERIFICATION ANSWERS:\n{qa_block}\n\n"
        f"RETRIEVED POLICY CLAUSES:\n{clauses_block}\n\n"
        "REQUIRED JSON SKELETON:\n"
        + json.dumps(
            {
                "overall_outcome": "approved | partial | denied | escalate_senior",
                "escalation_reason": None,
                "executive_summary": "2-3 sentence executive decision summary citing exact policy clauses and dollar figures.",
                "decisions_by_item": skeleton_items,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    raw_llm = await gmi.fast_json_completion(system_prompt, user_prompt)
    return post_process_settlement(
        case=case,
        analysis=analysis,
        resolved_answers=resolved_answers,
        raw_llm=raw_llm,
    )
