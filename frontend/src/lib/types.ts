export type PolicyCategory =
  | "coverage"
  | "exclusion"
  | "sublimit"
  | "definition"
  | "general";

export interface HealthResponse {
  status: string;
  embedding_model: string;
  vision_model: string;
  reasoning_model: string;
  chunk_count: number;
  doc_count: number;
  gmi_configured: boolean;
}

export interface PolicyChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  clause_id: string;
  parent_article: string;
  title: string;
  category: PolicyCategory;
  text: string;
  cross_refs: string[];
}

export interface PolicyDocumentSummary {
  doc_id: string;
  title: string;
  filename: string;
  chunk_count: number;
  cross_ref_edges: number;
}

export interface PoliciesResponse {
  documents: PolicyDocumentSummary[];
  chunks: PolicyChunk[];
}

export interface RetrievalHit {
  chunk: PolicyChunk;
  cosine_score: number;
  bm25_score: number;
  rrf_score: number;
  retrieval_reason: "hybrid_match" | "cross_ref_expansion";
  linked_from?: string | null;
}

export interface EvidenceFile {
  filename: string;
  label: string;
  url: string;
}

export interface ExtractedReceiptItem {
  item_id: string;
  description: string;
  category: string;
  original_amount: string;
  claimed_usd: number;
  source_doc: string;
}

export interface ClaimCase {
  case_id: string;
  title: string;
  subtitle: string;
  claimant_name: string;
  route: string;
  flight_number: string;
  policy_purchased_at: string;
  incident_time: string;
  delay_hours: number;
  claim_type: string;
  narrative: string;
  evidence_files: EvidenceFile[];
  pre_extracted_items: ExtractedReceiptItem[];
  badge: string;
}

export interface VerificationQuestion {
  id: string;
  question: string;
  clause_id: string;
  why_it_matters: string;
  options: string[];
  suggested_answer: string;
  evidence_hint: string;
}

export interface AnalyzeClaimResponse {
  case_id: string;
  vision_summary: string;
  vision_cached: boolean;
  extracted_items: ExtractedReceiptItem[];
  queries_executed: string[];
  retrieval_trace: RetrievalHit[];
  questions: VerificationQuestion[];
  naive_ai_estimate_usd: number;
  naive_ai_flaw: string;
}

export type LineItemStatus = "approved" | "capped" | "rejected" | "escalate";

export interface LineItemDecision {
  item_id: string;
  description: string;
  claimed_usd: number;
  approved_usd: number;
  status: LineItemStatus;
  clause_id: string;
  rationale: string;
}

export type OverallOutcome =
  | "approved"
  | "partial"
  | "denied"
  | "escalate_senior";

export interface SettlementReport {
  case_id: string;
  overall_outcome: OverallOutcome;
  total_claimed_usd: number;
  total_approved_usd: number;
  leakage_prevented_usd: number;
  held_for_review_usd: number;
  line_items: LineItemDecision[];
  escalation_reason?: string | null;
  executive_summary: string;
  markdown_notice: string;
}
