"use client";

import React from "react";
import {
  Plus,
  Plane,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Inbox,
} from "lucide-react";
import type { ClaimCase, OverallOutcome } from "@/lib/types";
import { formatRoute, formatUsd } from "@/lib/api";

interface ClaimSelectorProps {
  claims: ClaimCase[];
  selectedCaseId: string | null;
  onSelectClaim: (caseId: string) => void;
  onOpenNewClaimModal: () => void;
  analyzedCaseIds: Set<string>;
  settledOutcomes: Record<string, OverallOutcome>;
  settledApprovedUsd?: Record<string, number>;
}

function getTrapBadgeStyle(badge: string): string {
  const lower = (badge || "").toLowerCase();
  if (
    lower.includes("denial") ||
    lower.includes("exclusion") ||
    lower.includes("home")
  ) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (
    lower.includes("escalat") ||
    lower.includes("pnr") ||
    lower.includes("senior")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (
    lower.includes("partial") ||
    lower.includes("cap") ||
    lower.includes("hero") ||
    lower.includes("sub-limit") ||
    lower.includes("trap")
  ) {
    return "border-indigo-200 bg-indigo-50 text-indigo-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function renderOutcomeIndicator(
  outcome: OverallOutcome | undefined,
  approvedUsd: number | undefined,
  isAnalyzed: boolean
) {
  if (outcome === "approved" || outcome === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 tabular-nums">
        <CheckCircle2 className="h-3 w-3" />
        {outcome === "partial" ? "Partial" : "Approved"}
        {typeof approvedUsd === "number" ? ` · ${formatUsd(approvedUsd)}` : ""}
      </span>
    );
  }
  if (outcome === "denied") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 tabular-nums">
        <XCircle className="h-3 w-3" />
        Denied · $0.00
      </span>
    );
  }
  if (outcome === "escalate_senior") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Escalated to Senior
      </span>
    );
  }
  if (isAnalyzed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
        <Sparkles className="h-3 w-3" />
        In Review (Step 2)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
      Pending Review
    </span>
  );
}

export function ClaimSelector({
  claims,
  selectedCaseId,
  onSelectClaim,
  onOpenNewClaimModal,
  analyzedCaseIds,
  settledOutcomes,
  settledApprovedUsd = {},
}: ClaimSelectorProps) {
  const settledCount = Object.keys(settledOutcomes).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 py-2">
      {/* Clerk Role Welcome & Queue Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white uppercase">
              <Inbox className="h-3 w-3" />
              Claims Inbox
            </span>
            <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
              {settledCount} of {claims.length} adjudicated
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-slate-950">
            Select an Inbound Claim Packet to Begin Guided Review
          </h1>
          <p className="max-w-2xl text-xs leading-relaxed text-slate-600">
            Click any claim below. ClausePilot will inspect the receipts, pull matching
            policy rules &amp; exclusions, ask you 2–3 plain-English factual checks, and
            compute the exact settlement payout.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenNewClaimModal}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-slate-800 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" />
          <span>New Claim Packet</span>
        </button>
      </div>

      {/* Claims Inbox Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {claims.map((claim) => {
          const isSelected = claim.case_id === selectedCaseId;
          const preTotal = (claim.pre_extracted_items || []).reduce(
            (acc, item) => acc + (Number(item.claimed_usd) || 0),
            0
          );
          const outcome = settledOutcomes[claim.case_id];
          const approvedUsd = settledApprovedUsd[claim.case_id];
          const isAnalyzed = analyzedCaseIds.has(claim.case_id);

          return (
            <button
              key={claim.case_id}
              type="button"
              onClick={() => onSelectClaim(claim.case_id)}
              className={`group flex h-full flex-col justify-between rounded-2xl border bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md ${
                isSelected
                  ? "border-indigo-600 shadow-sm ring-2 ring-indigo-600/15"
                  : "border-slate-200 shadow-xs"
              }`}
            >
              <div>
                {/* Top Row: Case ID + Status */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white">
                    {claim.case_id}
                  </span>
                  {renderOutcomeIndicator(outcome, approvedUsd, isAnalyzed)}
                </div>

                {/* Title & Claimant */}
                <h2 className="text-base font-bold leading-snug text-slate-950 group-hover:text-indigo-700">
                  {claim.title}
                </h2>
                {claim.subtitle && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {claim.subtitle}
                  </p>
                )}

                {/* Route + Flight + Delay Pills */}
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200/80 bg-indigo-50/70 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-900">
                    <Plane className="h-3 w-3 text-indigo-600" />
                    {formatRoute(claim.route)}
                  </span>

                  {claim.flight_number && (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                      {claim.flight_number}
                    </span>
                  )}

                  {claim.delay_hours > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200/80 bg-amber-50/70 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-900 tabular-nums">
                      <Clock className="h-3 w-3 text-amber-600" />
                      {Number(claim.delay_hours.toFixed(1))}h delay
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-5 space-y-3 border-t border-slate-100 pt-3.5">
                {/* Scenario Tag + Claimed Amount */}
                <div className="flex items-center justify-between gap-2">
                  {claim.badge ? (
                    <span
                      className={`truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getTrapBadgeStyle(
                        claim.badge
                      )}`}
                    >
                      {claim.badge}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-400">
                      Custom Packet
                    </span>
                  )}

                  {preTotal > 0 ? (
                    <div className="shrink-0 text-right">
                      <span className="block text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                        Claimed
                      </span>
                      <span className="font-mono text-sm font-bold text-slate-950 tabular-nums">
                        {formatUsd(preTotal)}
                      </span>
                    </div>
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] text-slate-400">
                      OCR on Open
                    </span>
                  )}
                </div>

                {/* Clear Clerk CTA */}
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2 text-xs font-bold text-indigo-700 transition group-hover:bg-indigo-600 group-hover:text-white">
                  <span>
                    {outcome
                      ? "View Adjudicated Case"
                      : isAnalyzed
                        ? "Continue Guided Review"
                        : "Open Claim Review"}
                  </span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
