from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.models import ClaimCase, EvidenceFile, ExtractedReceiptItem
from app.rag import HybridPolicyRAG

_CJK_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in _CJK_FONT_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def _draw_document_card(
    out_path: Path,
    banner_bg: tuple[int, int, int],
    banner_title: str,
    banner_sub: str,
    sections: list[tuple[str, list[tuple[str, str, str | None]]]],
    footer_note: str,
) -> None:
    """Render a crisp, high-contrast 1100px evidence PNG suitable for 1080p zoom & Gemini Vision OCR."""
    width = 1100
    height = 1180
    img = Image.new("RGB", (width, height), color=(248, 250, 252))
    draw = ImageDraw.Draw(img)

    font_h1 = _load_font(28)
    font_sub = _load_font(18)
    font_sec = _load_font(20)
    font_lbl = _load_font(18)
    font_val = _load_font(19)
    font_foot = _load_font(16)

    # Outer paper card with border
    card_box = (28, 24, width - 28, height - 24)
    draw.rounded_rectangle(card_box, radius=14, fill=(255, 255, 255), outline=(203, 213, 225), width=2)

    # Top header banner
    draw.rounded_rectangle((28, 24, width - 28, 132), radius=14, fill=banner_bg)
    draw.rectangle((28, 95, width - 28, 132), fill=banner_bg)
    draw.text((58, 44), banner_title, fill=(255, 255, 255), font=font_h1)
    draw.text((58, 86), banner_sub, fill=(226, 232, 240), font=font_sub)

    y = 156
    for sec_title, rows in sections:
        # Section header bar
        draw.rounded_rectangle((54, y, width - 54, y + 38), radius=6, fill=(241, 245, 249))
        draw.text((68, y + 7), sec_title, fill=(15, 23, 42), font=font_sec)
        y += 50

        for label, value, highlight in rows:
            val_color = (15, 23, 42)
            row_bg = None
            if highlight == "danger":
                val_color = (185, 28, 28)
                row_bg = (254, 242, 242)
            elif highlight == "accent":
                val_color = (4, 120, 87)
                row_bg = (236, 253, 245)
            elif highlight == "warn":
                val_color = (180, 83, 9)
                row_bg = (255, 251, 235)

            if row_bg is not None:
                draw.rounded_rectangle((58, y - 4, width - 58, y + 34), radius=5, fill=row_bg)

            draw.text((68, y), label, fill=(71, 85, 105), font=font_lbl)
            draw.text((430, y), value, fill=val_color, font=font_val)
            y += 38
            draw.line((68, y - 4, width - 68, y - 4), fill=(241, 245, 249), width=1)

        y += 16

    # Official verification stamp box
    stamp_box = (width - 330, height - 150, width - 66, height - 56)
    draw.rounded_rectangle(stamp_box, radius=8, outline=(37, 99, 235), width=2)
    draw.text((width - 312, height - 136), "VERIFIED SOURCE RECORD", fill=(37, 99, 235), font=font_foot)
    draw.text((width - 312, height - 110), "ClausePilot Evidence Vault", fill=(51, 65, 85), font=font_foot)
    draw.text((width - 312, height - 84), "Tax / Carrier Certified Copy", fill=(100, 116, 139), font=font_foot)

    draw.text((58, height - 84), footer_note, fill=(100, 116, 139), font=font_foot)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG")


def _render_evidence_pngs(evidence_dir: Path) -> None:
    evidence_dir.mkdir(parents=True, exist_ok=True)

    # 1. CLM-8841 Delay Certificate
    cert_8841 = evidence_dir / "clm_8841_delay_cert.png"
    if not cert_8841.exists():
        _draw_document_card(
            out_path=cert_8841,
            banner_bg=(15, 23, 42),
            banner_title="STARLUX AIRLINES 星宇航空 — FLIGHT DELAY CERTIFICATE",
            banner_sub="班機延誤證明書 | Cert No: JX-2026-1031-8841 | Issued at Tokyo Narita (NRT)",
            sections=[
                (
                    "1. PASSENGER & ITINERARY RECORD (旅客與訂位資料)",
                    [
                        ("Passenger Name:", "CHEN, WEI-TING (陳威廷)", None),
                        ("Booking PNR:", "6N8K2P (Single-PNR Round-Trip Ticket TPE-NRT-TPE)", "accent"),
                        ("Affected Flight:", "JX805 — Tokyo Narita (NRT) -> Taipei Taoyuan (TPE)", None),
                        ("Policy Purchased:", "2026-10-25 14:10 TST (4 days BEFORE Typhoon Warning)", "accent"),
                    ],
                ),
                (
                    "2. DELAY TIMELINE & METEOROLOGICAL CAUSE (延誤時數與原因)",
                    [
                        ("Scheduled Departure:", "2026-10-31 20:15 JST (Tokyo Narita Terminal 2)", None),
                        ("Actual Departure:", "2026-11-01 02:40 JST (Recovery Flight JX805D)", None),
                        ("Confirmed Delay:", "6 hours 25 minutes (Overnight Stranding Abroad in Tokyo)", "warn"),
                        ("Disruption Cause:", "Typhoon Kong-rey (康芮颱風) Closure of Destination TPE", None),
                        ("CWA Typhoon Warning:", "Issued 2026-10-29 08:30 TST (AFTER Policy Purchase)", "accent"),
                    ],
                ),
                (
                    "3. RECOVERY FLIGHT & FIXED BENEFIT CLAIM (替代航班確認與定額申請)",
                    [
                        ("First Available Flight:", "YES — Passenger boarded first recovery slot JX805D", "accent"),
                        ("Article 21 Fixed Tier:", "USD $250.00 Claimed (6h to <12h Flight Delay Tier)", "accent"),
                    ],
                ),
            ],
            footer_note="Carrier Irregularity Operations Control • Narita International Airport Station (NRT)",
        )

    # 2. CLM-8841 Hotel + Izakaya Receipt
    rcpt_8841 = evidence_dir / "clm_8841_receipt.png"
    if not rcpt_8841.exists():
        _draw_document_card(
            out_path=rcpt_8841,
            banner_bg=(30, 58, 138),
            banner_title="TOKYO OVERNIGHT DELAY ITEMIZED RECEIPTS (東京過夜住宿與餐飲收據)",
            banner_sub="Claimant: CHEN, WEI-TING | Stranding City: Shinjuku, Tokyo | FX Rate: 1 USD = 150 JPY",
            sections=[
                (
                    "RECEIPT A — SHINJUKU PRINCE HOTEL 新宿プリンスホテル (Invoice #SPH-90412)",
                    [
                        ("Stay Period:", "2026-10-31 to 2026-11-01 (1 Night Emergency Lodging)", None),
                        ("Room Description:", "Standard Room (1 Adult, incl. Tokyo Accommodation Tax)", None),
                        ("Billed Amount:", "¥36,000 JPY  (Equivalent: USD $240.00)", "warn"),
                    ],
                ),
                (
                    "RECEIPT B — UOTAMI IZAKAYA SHINJUKU 魚民 新宿店 居酒屋領収書 (#IZK-4418)",
                    [
                        ("Transaction Time:", "2026-10-31 21:50 JST (During JX805 Overnight Delay)", None),
                        ("Line 1 (Food Meal):", "Grilled Fish & Sashimi Set Dinner 定食 — ¥8,250 (USD $55.00)", "accent"),
                        ("Line 2 (Alcohol):", "Draft Beer 生ビール x2 Mugs — ¥3,300 (USD $22.00)", "danger"),
                        ("Izakaya Subtotal:", "¥11,550 JPY  (Equivalent: USD $77.00)", None),
                    ],
                ),
                (
                    "CLAIMANT SUBMITTED PACKET SUMMARY (CLM-8841 申請理賠總表)",
                    [
                        ("1. Delay Tier (Art. 21):", "USD $250.00 (6h 25m Confirmed Delay)", None),
                        ("2. Hotel (1 Night):", "¥36,000  ->  USD $240.00", "warn"),
                        ("3. Dinner Set (定食):", "¥8,250   ->  USD $55.00", None),
                        ("4. Draft Beer (生ビール):", "¥3,300   ->  USD $22.00", "danger"),
                        ("TOTAL CLAIMED USD:", "USD $567.00", "warn"),
                    ],
                ),
            ],
            footer_note="Dual-Currency Settlement Sheet • Verified Original Tax Receipts Attached (1 USD = 150 JPY)",
        )

    # 3. CLM-8842 Baggage Receipt (Home-Country Arrival Trap)
    rcpt_8842 = evidence_dir / "clm_8842_baggage_receipt.png"
    if not rcpt_8842.exists():
        _draw_document_card(
            out_path=rcpt_8842,
            banner_bg=(6, 95, 70),
            banner_title="EVA AIR 長榮航空 PIR & TAIPEI EMERGENCY PURCHASE RECEIPT",
            banner_sub="行李延誤證明與台北購買收據 | PIR Ref: TPEXBR-88420 | FX Rate: 1 USD = 32.0 TWD",
            sections=[
                (
                    "1. PROPERTY IRREGULARITY REPORT (行李延誤紀錄 — 返國入境航段)",
                    [
                        ("Passenger Name:", "LIN, YA-HSUAN (林雅萱) | Residence: Da'an Dist., Taipei", None),
                        ("Return Flight Leg:", "BR197 — Tokyo Narita (NRT) -> Taipei Taoyuan (TPE)", "danger"),
                        ("Arrival Destination:", "Taipei Taoyuan Airport (TPE) — HOME COUNTRY ARRIVAL", "danger"),
                        ("Passenger Landed TPE:", "2026-11-02 17:20 TST", None),
                        ("Baggage Delivered:", "2026-11-03 08:20 TST (15 hours 00 minutes Baggage Delay)", "warn"),
                    ],
                ),
                (
                    "2. TAIPEI RETAIL RECEIPT — UNIQLO MINGYAO & WATSONS (統一發票 TW-88392014)",
                    [
                        ("Merchant Location:", "Zhongxiao East Rd, Taipei, Taiwan (Purchased AFTER landing TPE)", "danger"),
                        ("Receipt Timestamp:", "2026-11-02 20:15 TST", None),
                        ("Itemized Goods:", "Uniqlo Apparel, Change of Clothes & Basic Toiletries Set", None),
                        ("Billed Amount:", "NT$10,880 TWD  (Equivalent: USD $340.00)", "warn"),
                    ],
                ),
                (
                    "3. CLAIMANT SUBMITTED SUMMARY (CLM-8842 理賠申請金額)",
                    [
                        ("Total Claimed USD:", "USD $340.00 (15h Delayed Baggage upon TPE Return)", "warn"),
                    ],
                ),
            ],
            footer_note="EVA Airways Baggage Services TPE Terminal 2 • Taiwan GUI Tax Invoice Attached",
        )

    # 4. CLM-8843 Split-PNR Missed Connection Receipt
    rcpt_8843 = evidence_dir / "clm_8843_split_pnr.png"
    if not rcpt_8843.exists():
        _draw_document_card(
            out_path=rcpt_8843,
            banner_bg=(67, 56, 202),
            banner_title="SPLIT-PNR MISSED CONNECTION & WALK-UP REBOOKING INVOICE",
            banner_sub="雙訂位代號轉機失接與現場重購機票收據 | Route: TPE -> HKG -> LHR | 1 USD = 7.80 HKD",
            sections=[
                (
                    "1. TICKET #1 — FEEDER FLIGHT (獨立訂位代號 #1 — 中華航空)",
                    [
                        ("Passenger Name:", "WANG, BO-HAN (王柏翰)", None),
                        ("Carrier & Flight:", "China Airlines CI903 — Taipei (TPE) -> Hong Kong (HKG)", None),
                        ("Booking Reference #1:", "PNR: 7K9X2A (Ticket 297-441098211 — Issued via OTA)", "danger"),
                        ("Actual Arrival HKG:", "2026-11-04 12:20 HKT (Sched 10:05 — Delayed 2h 15m)", "warn"),
                    ],
                ),
                (
                    "2. TICKET #2 — SEPARATE LONG-HAUL TICKET (獨立訂位代號 #2 — 國泰航空)",
                    [
                        ("Carrier & Flight:", "Cathay Pacific CX251 — Hong Kong (HKG) -> London (LHR)", None),
                        ("Booking Reference #2:", "PNR: M4P81Q (Ticket 160-887412009 — SEPARATE TICKET)", "danger"),
                        ("Ticket Coupling:", "TWO SEPARATE PNRs (7K9X2A != M4P81Q — Self-Transfer)", "danger"),
                        ("Missed Departure:", "2026-11-04 11:55 HKT — Marked No-Show (No Interline Waiver)", "danger"),
                    ],
                ),
                (
                    "3. HKG AIRPORT WALK-UP REBOOKING RECEIPT (香港機場現場重購單程機票)",
                    [
                        ("Replacement Flight:", "Cathay Pacific CX255 (HKG -> LHR Economy Walk-Up Fare)", None),
                        ("Amount Paid:", "HK$11,076 HKD  (Equivalent: USD $1,420.00)", "warn"),
                        ("TOTAL CLAIMED USD:", "USD $1,420.00", "warn"),
                    ],
                ),
            ],
            footer_note="Hong Kong International Airport Ticketing Desk • Separate E-Ticket Coupons Verified",
        )


def ensure_seed_data(data_dir: Path, rag: HybridPolicyRAG) -> dict[str, ClaimCase]:
    """Ensure ground-truth policy is indexed, ONNX embedder is warm, PNGs exist, and return seeded cases."""
    data_dir = Path(data_dir)
    policy_path = data_dir / "policies" / "pacific_shield_travel_2026.md"
    evidence_dir = data_dir / "evidence"

    existing_doc_ids = {d.doc_id for d in rag.list_documents()}
    if "pacific_shield_2026" not in existing_doc_ids and policy_path.exists():
        content = policy_path.read_text(encoding="utf-8")
        rag.ingest_markdown_or_text(
            doc_id="pacific_shield_2026",
            title="PacificShield Comprehensive Travel Inconvenience Policy (2026 Taiwan Outbound Edition)",
            filename=policy_path.name,
            content=content,
        )
    else:
        # Ensure embedder is pre-warmed even when vector store loaded instantly from disk
        rag._get_embedder()

    _render_evidence_pngs(evidence_dir)

    cases: dict[str, ClaimCase] = {
        "CLM-8841": ClaimCase(
            case_id="CLM-8841",
            title="Tokyo Typhoon Stranding — Hotel & Izakaya",
            subtitle="Starlux JX805 (NRT → TPE) delayed 6h 25m overnight due to Typhoon Kong-rey",
            claimant_name="Wei-Ting Chen (陳威廷)",
            route="NRT → TPE",
            flight_number="JX805",
            policy_purchased_at="2026-10-25 14:10 TST",
            incident_time="2026-10-31 20:15 JST (CWA Typhoon Warning: 2026-10-29 08:30 TST)",
            delay_hours=6.42,
            claim_type="flight_delay",
            narrative=(
                "My return flight Starlux JX805 from Tokyo Narita (NRT) back to Taipei (TPE) scheduled for "
                "2026-10-31 20:15 JST was delayed 6 hours 25 minutes overnight until 02:40 JST on Nov 1 because "
                "Typhoon Kong-rey closed Taipei Taoyuan Airport. I bought my policy on Oct 25 before CWA issued "
                "the typhoon warning on Oct 29, and I boarded the first recovery flight JX805D. Claiming the $250 "
                "fixed flight delay benefit plus my Shinjuku Prince Hotel room (¥36,000 / $240.00) and izakaya "
                "set dinner 定食 (¥8,250 / $55.00) + two draft beers 生ビール (¥3,300 / $22.00), totaling $567.00."
            ),
            evidence_files=[
                EvidenceFile(
                    filename="clm_8841_delay_cert.png",
                    label="Starlux JX805 Delay Certificate",
                    url="/static/evidence/clm_8841_delay_cert.png",
                ),
                EvidenceFile(
                    filename="clm_8841_receipt.png",
                    label="Shinjuku Hotel & Izakaya Receipt",
                    url="/static/evidence/clm_8841_receipt.png",
                ),
            ],
            pre_extracted_items=[
                ExtractedReceiptItem(
                    item_id="item_delay_tier",
                    description="Flight Delay Fixed Benefit (6h 25m delay, JX805 NRT→TPE)",
                    category="fixed_benefit",
                    original_amount="USD $250.00",
                    claimed_usd=250.00,
                    source_doc="clm_8841_delay_cert.png",
                ),
                ExtractedReceiptItem(
                    item_id="item_hotel",
                    description="Shinjuku Prince Hotel — 1 Night Emergency Lodging",
                    category="accommodation",
                    original_amount="¥36,000",
                    claimed_usd=240.00,
                    source_doc="clm_8841_receipt.png",
                ),
                ExtractedReceiptItem(
                    item_id="item_dinner",
                    description="Izakaya Set Dinner (焼き魚・刺身定食)",
                    category="meal",
                    original_amount="¥8,250",
                    claimed_usd=55.00,
                    source_doc="clm_8841_receipt.png",
                ),
                ExtractedReceiptItem(
                    item_id="item_beer",
                    description="Draft Beer x2 (生ビール 中ジョッキ x2)",
                    category="alcohol",
                    original_amount="¥3,300",
                    claimed_usd=22.00,
                    source_doc="clm_8841_receipt.png",
                ),
            ],
            badge="Sub-Limit + Alcohol Trap",
        ),
        "CLM-8842": ClaimCase(
            case_id="CLM-8842",
            title="Home-Airport Arrival Baggage Delay",
            subtitle="EVA Air BR197 (NRT → TPE) checked baggage delayed 15h upon return to Taipei",
            claimant_name="Ya-Hsuan Lin (林雅萱)",
            route="NRT → TPE",
            flight_number="BR197",
            policy_purchased_at="2026-10-26 09:30 TST",
            incident_time="2026-11-02 17:20 TST (Landed at Home Airport TPE)",
            delay_hours=15.0,
            claim_type="baggage_delay",
            narrative=(
                "Upon landing back home at Taipei Taoyuan Airport (TPE) on EVA Air BR197 from Tokyo Narita on "
                "Nov 2 at 17:20, my checked suitcase did not arrive on the carousel and was delivered 15 hours "
                "later to my Taipei residence at 08:20 on Nov 3. Since Article 26 covers baggage delayed over "
                "6 hours up to $400, I bought NT$10,880 ($340.00) of emergency Uniqlo clothing and toiletries "
                "in Taipei that evening and am claiming $340.00."
            ),
            evidence_files=[
                EvidenceFile(
                    filename="clm_8842_baggage_receipt.png",
                    label="EVA Air PIR & Taipei Uniqlo Receipt",
                    url="/static/evidence/clm_8842_baggage_receipt.png",
                ),
            ],
            pre_extracted_items=[
                ExtractedReceiptItem(
                    item_id="item_uniqlo_tpe",
                    description="Taipei Uniqlo Clothing & Toiletries (Post-TPE Return Arrival)",
                    category="baggage_essentials",
                    original_amount="NT$10,880",
                    claimed_usd=340.00,
                    source_doc="clm_8842_baggage_receipt.png",
                ),
            ],
            badge="Home-Airport Exclusion Trap",
        ),
        "CLM-8843": ClaimCase(
            case_id="CLM-8843",
            title="Split-PNR Missed London Connection",
            subtitle="CI903 (PNR 7K9X2A) delayed 2h 15m → missed separate CX251 (PNR M4P81Q)",
            claimant_name="Bo-Han Wang (王柏翰)",
            route="TPE → HKG → LHR",
            flight_number="CI903 / CX251",
            policy_purchased_at="2026-10-20 18:15 TST",
            incident_time="2026-11-04 12:20 HKT (2h 15m Feeder Delay at HKG)",
            delay_hours=2.25,
            claim_type="missed_connection",
            narrative=(
                "I booked China Airlines CI903 (TPE→HKG, PNR: 7K9X2A) on an OTA and separately bought Cathay "
                "Pacific CX251 (HKG→LHR, PNR: M4P81Q) direct with Cathay to save on fare. CI903 was delayed "
                "2 hours 15 minutes arriving HKG at 12:20, causing me to miss CX251 (11:55 departure). Because "
                "they were on two separate tickets/PNRs, Cathay treated me as a no-show and charged HK$11,076 "
                "(USD $1,420.00) for a walk-up economy seat on CX255."
            ),
            evidence_files=[
                EvidenceFile(
                    filename="clm_8843_split_pnr.png",
                    label="Split-PNR Tickets & HKG Rebooking Invoice",
                    url="/static/evidence/clm_8843_split_pnr.png",
                ),
            ],
            pre_extracted_items=[
                ExtractedReceiptItem(
                    item_id="item_rebook_cx",
                    description="Cathay Pacific CX255 Walk-Up Economy Rebooking (HKG→LHR, Separate PNR)",
                    category="rebooking_airfare",
                    original_amount="HK$11,076",
                    claimed_usd=1420.00,
                    source_doc="clm_8843_split_pnr.png",
                ),
            ],
            badge="Separate-PNR Escalation",
        ),
    }
    return cases
