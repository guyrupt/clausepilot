"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { TopNavBar, type AppMode } from "@/components/TopNavBar";
import { ClaimSelector } from "@/components/ClaimSelector";
import { NewClaimModal } from "@/components/NewClaimModal";
import { EvidenceViewer } from "@/components/EvidenceViewer";
import { VerificationChecklist } from "@/components/VerificationChecklist";
import { SettlementReportView } from "@/components/SettlementReportView";
import { RagTracePanel } from "@/components/RagTracePanel";
import { KnowledgeBaseView } from "@/components/KnowledgeBaseView";
import {
  adjudicateClaim,
  analyzeClaim,
  fetchClaims,
  fetchHealth,
  fetchPolicies,
} from "@/lib/api";
import type {
  AnalyzeClaimResponse,
  ClaimCase,
  HealthResponse,
  OverallOutcome,
  PolicyChunk,
  PolicyDocumentSummary,
  SettlementReport,
} from "@/lib/types";

export default function ClausePilotApp() {
  const [mode, setMode] = useState<AppMode>("workbench");

  // Global backend data
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [claims, setClaims] = useState<ClaimCase[]>([]);
  const [documents, setDocuments] = useState<PolicyDocumentSummary[]>([]);
  const [chunks, setChunks] = useState<PolicyChunk[]>([]);
  const [isBooting, setIsBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  // Selected claim & modal
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isNewClaimModalOpen, setIsNewClaimModalOpen] = useState(false);

  // Per-claim cached workflow state
  const [analysisByCase, setAnalysisByCase] = useState<
    Record<string, AnalyzeClaimResponse>
  >({});
  const [answersByCase, setAnswersByCase] = useState<
    Record<string, Record<string, string>>
  >({});
  const [settlementByCase, setSettlementByCase] = useState<
    Record<string, SettlementReport>
  >({});

  // Loading & error state for active claim actions
  const [analyzingCaseId, setAnalyzingCaseId] = useState<string | null>(null);
  const [rescanningCaseId, setRescanningCaseId] = useState<string | null>(null);
  const [adjudicatingCaseId, setAdjudicatingCaseId] = useState<string | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  // Clause highlighting in Right Rail
  const [highlightedClauseRef, setHighlightedClauseRef] = useState<
    string | null
  >(null);
  const [highlightSeq, setHighlightSeq] = useState(0);

  // Smooth stage scroll anchors
  const stage2Ref = useRef<HTMLDivElement | null>(null);
  const stage3Ref = useRef<HTMLDivElement | null>(null);

  const loadHealthAndPolicies = useCallback(async () => {
    try {
      const [h, pol] = await Promise.all([fetchHealth(), fetchPolicies()]);
      setHealth(h);
      setHealthError(false);
      setDocuments(pol.documents || []);
      setChunks(pol.chunks || []);
    } catch {
      setHealthError(true);
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    const [h, clm, pol] = await Promise.all([
      fetchHealth(),
      fetchClaims(),
      fetchPolicies(),
    ]);
    return { h, clm, pol };
  }, []);

  const handleRetryConnection = useCallback(async () => {
    setIsBooting(true);
    setBootError(null);
    try {
      const { h, clm, pol } = await fetchAllData();
      setHealth(h);
      setHealthError(false);
      const claimList = clm.claims || [];
      setClaims(claimList);
      setDocuments(pol.documents || []);
      setChunks(pol.chunks || []);
      setSelectedCaseId((prev) => prev || claimList[0]?.case_id || null);
    } catch (err) {
      setHealthError(true);
      setBootError(
        err instanceof Error
          ? err.message
          : "Unable to connect to ClausePilot FastAPI backend on port 8000."
      );
    } finally {
      setIsBooting(false);
    }
  }, [fetchAllData]);

  useEffect(() => {
    let cancelled = false;
    fetchAllData()
      .then(({ h, clm, pol }) => {
        if (cancelled) return;
        setHealth(h);
        setHealthError(false);
        const claimList = clm.claims || [];
        setClaims(claimList);
        setDocuments(pol.documents || []);
        setChunks(pol.chunks || []);
        setSelectedCaseId((prev) => prev || claimList[0]?.case_id || null);
        setIsBooting(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHealthError(true);
        setBootError(
          err instanceof Error
            ? err.message
            : "Unable to connect to ClausePilot FastAPI backend on port 8000."
        );
        setIsBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAllData]);

  const activeClaim =
    claims.find((c) => c.case_id === selectedCaseId) || claims[0] || null;
  const activeCaseId = activeClaim?.case_id || null;
  const activeAnalysis = activeCaseId
    ? analysisByCase[activeCaseId] || null
    : null;
  const activeAnswers = activeCaseId ? answersByCase[activeCaseId] || {} : {};
  const activeSettlement = activeCaseId
    ? settlementByCase[activeCaseId] || null
    : null;

  const handleSelectClaim = (caseId: string) => {
    setSelectedCaseId(caseId);
    setActionError(null);
    setHighlightedClauseRef(null);
  };

  const handleAnalyzeClaim = async (forceOcr: boolean) => {
    if (!activeCaseId) return;
    setActionError(null);
    setAnalyzingCaseId(activeCaseId);
    if (forceOcr) {
      setRescanningCaseId(activeCaseId);
    }
    try {
      const res = await analyzeClaim(activeCaseId, forceOcr);
      setAnalysisByCase((prev) => ({ ...prev, [activeCaseId]: res }));

      // Pre-populate suggested answers so demo presenter can inspect/click fast or compute immediately
      const defaultAnswers: Record<string, string> = {};
      for (const q of res.questions || []) {
        if (q.suggested_answer && q.options.includes(q.suggested_answer)) {
          defaultAnswers[q.id] = q.suggested_answer;
        } else if (q.options.length > 0 && q.suggested_answer) {
          defaultAnswers[q.id] = q.suggested_answer;
        }
      }
      setAnswersByCase((prev) => ({
        ...prev,
        [activeCaseId]: prev[activeCaseId] || defaultAnswers,
      }));

      setTimeout(() => {
        stage2Ref.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 80);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to analyze claim packet."
      );
    } finally {
      setAnalyzingCaseId(null);
      setRescanningCaseId(null);
    }
  };

  const handleSelectAnswer = (questionId: string, option: string) => {
    if (!activeCaseId) return;
    setAnswersByCase((prev) => ({
      ...prev,
      [activeCaseId]: {
        ...(prev[activeCaseId] || {}),
        [questionId]: option,
      },
    }));
  };

  const handleApplySuggestedAnswers = () => {
    if (!activeCaseId || !activeAnalysis) return;
    const suggested: Record<string, string> = {};
    for (const q of activeAnalysis.questions || []) {
      if (q.suggested_answer) {
        suggested[q.id] = q.suggested_answer;
      } else if (q.options[0]) {
        suggested[q.id] = q.options[0];
      }
    }
    setAnswersByCase((prev) => ({
      ...prev,
      [activeCaseId]: suggested,
    }));
  };

  const handleAdjudicateClaim = async () => {
    if (!activeCaseId) return;
    setActionError(null);
    setAdjudicatingCaseId(activeCaseId);
    try {
      const report = await adjudicateClaim(activeCaseId, activeAnswers);
      setSettlementByCase((prev) => ({ ...prev, [activeCaseId]: report }));
      setTimeout(() => {
        stage3Ref.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Failed to compute settlement report."
      );
    } finally {
      setAdjudicatingCaseId(null);
    }
  };

  const handleSelectClause = (clauseId: string) => {
    setHighlightedClauseRef(clauseId);
    setHighlightSeq((s) => s + 1);
  };

  const analyzedCaseIds = new Set(Object.keys(analysisByCase));
  const settledOutcomes: Record<string, OverallOutcome> = {};
  for (const [cid, rep] of Object.entries(settlementByCase)) {
    settledOutcomes[cid] = rep.overall_outcome;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <TopNavBar
        mode={mode}
        onModeChange={setMode}
        health={health}
        healthError={healthError}
        onRefreshHealth={() => void handleRetryConnection()}
      />

      {/* Global Loading or Connection Banner */}
      {isBooting ? (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
            <p className="text-sm font-bold text-slate-900">
              Connecting to ClausePilot Hybrid RAG & GMI Cloud Engine...
            </p>
            <p className="text-xs text-slate-500">
              Loading Taipei claim packets and PacificShield 2026 policy graph
            </p>
          </div>
        </div>
      ) : bootError ? (
        <div className="mx-auto my-12 max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-600" />
          <h2 className="mt-2 text-base font-bold text-slate-950">
            Backend API Unreachable
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {bootError}
          </p>
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
            Run ./dev.sh to start FastAPI (:8000) + Next.js (:3000)
          </p>
          <button
            type="button"
            onClick={() => void handleRetryConnection()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry Connection</span>
          </button>
        </div>
      ) : mode === "knowledge_base" ? (
        <main className="flex-1">
          <KnowledgeBaseView
            documents={documents}
            chunks={chunks}
            onPolicyUploaded={loadHealthAndPolicies}
          />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-5 lg:px-6">
          {/* Responsive 3-Column Desktop Workbench Layout */}
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[295px_minmax(0,1fr)_390px]">
            {/* Left Column: Claim Queue & New Claim Packet */}
            <ClaimSelector
              claims={claims}
              selectedCaseId={activeCaseId}
              onSelectClaim={handleSelectClaim}
              onOpenNewClaimModal={() => setIsNewClaimModalOpen(true)}
              analyzedCaseIds={analyzedCaseIds}
              settledOutcomes={settledOutcomes}
            />

            {/* Center Column: 3-Stage Guided Adjudication Flow */}
            <div className="min-w-0 space-y-5">
              {actionError && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{actionError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="font-bold text-rose-700 hover:underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {activeClaim ? (
                <>
                  {/* Stage 1: Claim Brief & Multimodal Evidence */}
                  <EvidenceViewer
                    claim={activeClaim}
                    analysis={activeAnalysis}
                    isAnalyzing={analyzingCaseId === activeCaseId}
                    isRescanningOcr={rescanningCaseId === activeCaseId}
                    onAnalyze={(forceOcr) => void handleAnalyzeClaim(forceOcr)}
                  />

                  {/* Stage 2: Clerk Guided Verification Checkpoints */}
                  {activeAnalysis && (
                    <div ref={stage2Ref}>
                      <VerificationChecklist
                        analysis={activeAnalysis}
                        answers={activeAnswers}
                        onSelectAnswer={handleSelectAnswer}
                        onApplySuggested={handleApplySuggestedAnswers}
                        onAdjudicate={() => void handleAdjudicateClaim()}
                        isAdjudicating={adjudicatingCaseId === activeCaseId}
                        onSelectClause={handleSelectClause}
                      />
                    </div>
                  )}

                  {/* Stage 3: Official Settlement Decision */}
                  {activeSettlement && (
                    <div ref={stage3Ref}>
                      <SettlementReportView
                        report={activeSettlement}
                        naiveAiEstimateUsd={
                          activeAnalysis?.naive_ai_estimate_usd
                        }
                        naiveAiFlaw={activeAnalysis?.naive_ai_flaw}
                        onSelectClause={handleSelectClause}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                  Select a claim packet from the queue or create a new packet to
                  begin.
                </div>
              )}
            </div>

            {/* Right Column: Technical Hybrid RAG & Cross-Reference Trace */}
            <RagTracePanel
              queriesExecuted={activeAnalysis?.queries_executed || []}
              hits={activeAnalysis?.retrieval_trace || []}
              highlightedClauseRef={highlightedClauseRef}
              highlightSeq={highlightSeq}
            />
          </div>
        </main>
      )}

      {/* New Claim Modal */}
      <NewClaimModal
        isOpen={isNewClaimModalOpen}
        onClose={() => setIsNewClaimModalOpen(false)}
        onCreated={(created) => {
          setClaims((prev) => [created, ...prev]);
          setSelectedCaseId(created.case_id);
          setMode("workbench");
        }}
      />
    </div>
  );
}
