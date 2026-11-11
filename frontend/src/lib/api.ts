import type {
  AnalyzeClaimResponse,
  ClaimCase,
  HealthResponse,
  PoliciesResponse,
  PolicyChunk,
  PolicyDocumentSummary,
  RetrievalHit,
  SettlementReport,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function resolveEvidenceUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") {
        detail = body.detail;
      } else if (body && Array.isArray(body.detail)) {
        detail = body.detail
          .map((d: { msg?: string }) => d.msg || JSON.stringify(d))
          .join("; ");
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
  return parseJsonOrThrow<HealthResponse>(res);
}

export async function fetchPolicies(): Promise<PoliciesResponse> {
  const res = await fetch(`${API_BASE}/api/policies`, { cache: "no-store" });
  return parseJsonOrThrow<PoliciesResponse>(res);
}

export async function uploadPolicy(
  file: File,
  title?: string
): Promise<PolicyDocumentSummary> {
  const formData = new FormData();
  formData.append("file", file);
  if (title && title.trim()) {
    formData.append("title", title.trim());
  }
  const res = await fetch(`${API_BASE}/api/policies/upload`, {
    method: "POST",
    body: formData,
  });
  return parseJsonOrThrow<PolicyDocumentSummary>(res);
}

export async function searchPolicies(
  query: string,
  topK = 6,
  expandCrossRefs = true
): Promise<{ hits: RetrievalHit[] }> {
  const res = await fetch(`${API_BASE}/api/policies/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      top_k: topK,
      expand_cross_refs: expandCrossRefs,
    }),
  });
  return parseJsonOrThrow<{ hits: RetrievalHit[] }>(res);
}

export async function fetchClaims(): Promise<{ claims: ClaimCase[] }> {
  const res = await fetch(`${API_BASE}/api/claims`, { cache: "no-store" });
  return parseJsonOrThrow<{ claims: ClaimCase[] }>(res);
}

export async function uploadClaim(params: {
  title: string;
  route: string;
  narrative: string;
  files: File[];
}): Promise<ClaimCase> {
  const formData = new FormData();
  formData.append("title", params.title.trim());
  formData.append("route", params.route.trim());
  formData.append("narrative", params.narrative.trim());
  for (const file of params.files) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/api/claims/upload`, {
    method: "POST",
    body: formData,
  });
  return parseJsonOrThrow<ClaimCase>(res);
}

export async function analyzeClaim(
  caseId: string,
  forceOcr = false
): Promise<AnalyzeClaimResponse> {
  const url = `${API_BASE}/api/claims/${encodeURIComponent(
    caseId
  )}/analyze?force_ocr=${forceOcr ? "true" : "false"}`;
  const res = await fetch(url, { method: "POST" });
  return parseJsonOrThrow<AnalyzeClaimResponse>(res);
}

export async function adjudicateClaim(
  caseId: string,
  answers: Record<string, string>
): Promise<SettlementReport> {
  const res = await fetch(
    `${API_BASE}/api/claims/${encodeURIComponent(caseId)}/adjudicate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    }
  );
  return parseJsonOrThrow<SettlementReport>(res);
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatRoute(route: string): string {
  if (!route) return "";
  return route.replace(/\s*->\s*/g, " → ");
}

/**
 * Extracts canonical numeric token (e.g., "24.3", "27.2", "21") so clicking
 * "[Art. 24.3]", "Section 24.3", or "Article 27.2" reliably matches PolicyChunk.
 */
export function extractClauseNumber(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[\[\]()]/g, "").trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : cleaned.toLowerCase();
}

export function chunkMatchesClauseRef(
  chunk: PolicyChunk,
  clauseRef: string | null | undefined
): boolean {
  if (!clauseRef) return false;
  const normTarget = clauseRef.replace(/[\[\]()]/g, "").trim().toLowerCase();
  if (
    chunk.clause_id.toLowerCase() === normTarget ||
    chunk.chunk_id.toLowerCase() === normTarget
  ) {
    return true;
  }
  const targetNum = extractClauseNumber(clauseRef);
  if (!targetNum) return false;
  const chunkNum = extractClauseNumber(chunk.clause_id);
  if (chunkNum === targetNum) return true;
  // Fallback if citation points to parent article (e.g. "Article 24" matching "Section 24.1")
  const parentNum = extractClauseNumber(chunk.parent_article);
  return !targetNum.includes(".") && parentNum === targetNum;
}
