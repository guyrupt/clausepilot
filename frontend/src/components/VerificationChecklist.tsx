"use client";

import React from "react";
import {
  CheckCircle2,
  Sparkles,
  Scale,
  Eye,
  Wand2,
  Loader2,
  AlertOctagon,
  BookOpen,
} from "lucide-react";
import type { AnalyzeClaimResponse } from "@/lib/types";
import { formatUsd } from "@/lib/api";

interface VerificationChecklistProps {
  analysis: AnalyzeClaimResponse;
  answers: Record<string, string>;
  onSelectAnswer: (questionId: string, option: string) => void;
  onApplySuggested: () => void;
  onAdjudicate: () => void;
  isAdjudicating: boolean;
  onSelectClause: (clauseId: string) => void;
}

export function VerificationChecklist({
  analysis,
  answers,
  onSelectAnswer,
  onApplySuggested,
  onAdjudicate,
  isAdjudicating,
  onSelectClause,
}: VerificationChecklistProps) {
  const questions = analysis.questions || [];
  const answeredCount = questions.filter((q) => Boolean(answers[q.id])).length;
  const allAnswered =
    questions.length === 0 || answeredCount === questions.length;

  const allMatchSuggested =
    questions.length > 0 &&
    questions.every(
      (q) => q.suggested_answer && answers[q.id] === q.suggested_answer
    );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      {/* Stage Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-indigo-600 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
            STAGE 02
          </span>
          <h2 className="text-xs font-bold tracking-wider text-slate-900 uppercase">
            Clerk Guided Verification Checkpoints
          </h2>
          <span className="hidden rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 sm:inline-block">
            Zero Prompting Required
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
            {answeredCount} / {questions.length} Confirmed
          </span>

          {questions.some((q) => Boolean(q.suggested_answer)) && (
            <button
              type="button"
              onClick={onApplySuggested}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                allMatchSuggested
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              }`}
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>
                {allMatchSuggested
                  ? "Evidence-Suggested Answers Applied"
                  : "Apply Evidence-Suggested Answers"}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Naive AI Comparison Callout */}
        {analysis.naive_ai_flaw && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200/90 bg-amber-50/60 p-3.5">
            <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-amber-950">
                  Why Unguided &ldquo;Chat-with-PDF&rdquo; RAG Fails Here:
                </span>
                {analysis.naive_ai_estimate_usd > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-900 tabular-nums">
                    Naive AI Estimate: {formatUsd(analysis.naive_ai_estimate_usd)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 leading-relaxed text-amber-900/90">
                {analysis.naive_ai_flaw}
              </p>
            </div>
          </div>
        )}

        {/* Clickable Verification Question Cards */}
        <div className="space-y-3.5">
          {questions.map((q, index) => {
            const selected = answers[q.id];
            return (
              <div
                key={q.id}
                className={`rounded-xl border p-4 transition ${
                  selected
                    ? "border-slate-300 bg-white"
                    : "border-indigo-200 bg-indigo-50/20"
                }`}
              >
                {/* Question Top Row */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 font-mono text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <h3 className="text-sm font-bold leading-snug text-slate-950">
                      {q.question}
                    </h3>
                  </div>

                  {q.clause_id && (
                    <button
                      type="button"
                      onClick={() => onSelectClause(q.clause_id)}
                      title="Highlight this clause in the Hybrid RAG Trace panel"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-100"
                    >
                      <BookOpen className="h-3 w-3" />
                      <span>[{q.clause_id}]</span>
                    </button>
                  )}
                </div>

                {/* Why It Matters + Evidence Hint */}
                <div className="mt-2.5 grid grid-cols-1 gap-2 pl-7 md:grid-cols-2">
                  {q.why_it_matters && (
                    <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs">
                      <span className="mb-0.5 flex items-center gap-1 text-[10px] font-bold tracking-wide text-slate-500 uppercase">
                        <Scale className="h-3 w-3 text-indigo-500" />
                        Why This Matters
                      </span>
                      <p className="leading-relaxed text-slate-700">
                        {q.why_it_matters}
                      </p>
                    </div>
                  )}

                  {q.evidence_hint && (
                    <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/40 px-3 py-2 text-xs">
                      <span className="mb-0.5 flex items-center gap-1 text-[10px] font-bold tracking-wide text-emerald-800 uppercase">
                        <Eye className="h-3 w-3 text-emerald-600" />
                        Evidence Hint (OCR Verified)
                      </span>
                      <p className="leading-relaxed text-slate-700">
                        {q.evidence_hint}
                      </p>
                    </div>
                  )}
                </div>

                {/* Clickable Answer Pills */}
                <div className="mt-3 flex flex-col gap-2 pl-7">
                  {(q.options || []).map((option) => {
                    const isSelected = selected === option;
                    const isSuggested =
                      Boolean(q.suggested_answer) &&
                      q.suggested_answer === option;

                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => onSelectAnswer(q.id, option)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-xs font-medium transition ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/80 font-semibold text-indigo-950 ring-1 ring-indigo-600/30"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              isSelected
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-slate-300 bg-white"
                            }`}
                          >
                            {isSelected && (
                              <CheckCircle2 className="h-3 w-3 text-white" />
                            )}
                          </span>
                          <span className="leading-snug">{option}</span>
                        </div>

                        {isSuggested && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <Sparkles className="h-2.5 w-2.5" />
                            Evidence Match
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Adjudicate CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            {allAnswered
              ? "All policy checkpoints verified. Ready for deterministic payout adjudication."
              : `Please confirm all ${questions.length} policy checkpoints to compute official settlement.`}
          </p>

          <button
            type="button"
            onClick={onAdjudicate}
            disabled={!allAnswered || isAdjudicating}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAdjudicating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                <span>Computing Official Settlement...</span>
              </>
            ) : (
              <>
                <Scale className="h-4 w-4 text-emerald-400" />
                <span>Compute Official Settlement</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
