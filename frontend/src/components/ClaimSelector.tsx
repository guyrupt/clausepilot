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
}

function getTrapBadgeStyle(badge: string): string {
  const lower = (badge || "").toLowerCase();
  if (lower.includes("denial") || lower.includes("exclusion") || lower.includes("home")) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (lower.includes("escalat") || lower.includes("pnr") || lower.includes("senior")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (lower.includes("partial") || lower.includes("cap") || lower.includes("hero") || lower.includes("sub-limit") || lower.includes("trap")) {
    return "border-indigo-200 bg-indigo-50 text-indigo-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function renderOutcomeIndicator(
  outcome: OverallOutcome | undefined,
  isAnalyzed: boolean
) {
  if (outcome === "approved" || outcome === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        {outcome === "partial" ? "Partial" : "Approved"}
      </span>
    );
  }
  if (outcome === "denied") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
        <XCircle className="h-3 w-3" />
        Denied
      </span>
    );
  }
  if (outcome === "escalate_senior") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Escalated
      </span>
    );
  }
  if (isAnalyzed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
        <Sparkles className="h-2.5 w-2.5" />
        Analyzed
      </span>
    );
  }
  return null;
}

export function ClaimSelector({
  claims,
  selectedCaseId,
  onSelectClaim,
  onOpenNewClaimModal,
  analyzedCaseIds,
  settledOutcomes,
}: ClaimSelectorProps) {
  return (
    <aside className="flex flex-col gap-3">
      {/* Queue Header + New Claim Packet CTA */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold tracking-wider text-slate-900 uppercase">
              Inbound Claims Queue
            </h2>
            <p className="text-[11px] text-slate-500">
              {claims.length} packets ready for review
            </p>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
            {claims.length}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenNewClaimModal}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 active:scale-[0.99]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Claim Packet</span>
        </button>
      </div>

      {/* Claims List */}
      <div className="flex flex-col gap-2.5">
        {claims.map((claim) => {
          const isSelected = claim.case_id === selectedCaseId;
          const preTotal = (claim.pre_extracted_items || []).reduce(
            (acc, item) => acc + (Number(item.claimed_usd) || 0),
            0
          );
          const outcome = settledOutcomes[claim.case_id];
          const isAnalyzed = analyzedCaseIds.has(claim.case_id);

          return (
            <button
              key={claim.case_id}
              type="button"
              onClick={() => onSelectClaim(claim.case_id)}
              className={`group w-full rounded-xl border p-3.5 text-left transition-all ${
                isSelected
                  ? "border-indigo-600 bg-white shadow-sm ring-2 ring-indigo-600/15"
                  : "border-slate-200 bg-white/90 hover:border-slate-300 hover:bg-white"
              }`}
            >
              {/* Top Row: Case ID + Status */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                    isSelected
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-800 group-hover:bg-slate-200/80"
                  }`}
                >
                  {claim.case_id}
                </span>
                {renderOutcomeIndicator(outcome, isAnalyzed)}
              </div>

              {/* Title & Claimant */}
              <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">
                {claim.title}
              </h3>
              {claim.subtitle && (
                <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                  {claim.subtitle}
                </p>
              )}

              {/* Route + Flight + Delay Pills */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                  <Plane className="h-3 w-3 text-indigo-600" />
                  {formatRoute(claim.route)}
                </span>

                {claim.flight_number && (
                  <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                    {claim.flight_number}
                  </span>
                )}

                {claim.delay_hours > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-200/80 bg-amber-50/70 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-900 tabular-nums">
                    <Clock className="h-2.5 w-2.5 text-amber-600" />
                    {Number(claim.delay_hours.toFixed(1))}h
                  </span>
                )}
              </div>

              {/* Footer: Scenario Trap Tag + Claimed Amount */}
              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                {claim.badge ? (
                  <span
                    className={`truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold ${getTrapBadgeStyle(
                      claim.badge
                    )}`}
                  >
                    {claim.badge}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-slate-400">
                    Custom Packet
                  </span>
                )}

                {preTotal > 0 ? (
                  <span className="shrink-0 font-mono text-xs font-bold text-slate-900 tabular-nums">
                    {formatUsd(preTotal)}
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">
                    OCR Pending
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
