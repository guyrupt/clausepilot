"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Copy,
  Check,
  BookOpen,
  TrendingDown,
  FileCode2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type {
  LineItemStatus,
  OverallOutcome,
  SettlementReport,
} from "@/lib/types";
import { formatUsd } from "@/lib/api";

interface SettlementReportViewProps {
  report: SettlementReport;
  naiveAiEstimateUsd?: number;
  naiveAiFlaw?: string;
  onSelectClause: (clauseId: string) => void;
}

function getOutcomeBannerConfig(outcome: OverallOutcome) {
  switch (outcome) {
    case "approved":
      return {
        label: "CLAIM APPROVED IN FULL",
        containerClass:
          "border-emerald-300 bg-gradient-to-r from-emerald-600 to-teal-600 text-white",
        badgeClass: "bg-white/20 text-white ring-1 ring-white/30",
        icon: CheckCircle2,
      };
    case "partial":
      return {
        label: "PARTIAL APPROVAL — POLICY CAPS & EXCLUSIONS ENFORCED",
        containerClass:
          "border-indigo-300 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white",
        badgeClass: "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/40",
        icon: CheckCircle2,
      };
    case "denied":
      return {
        label: "CLAIM DENIED — MANDATORY POLICY EXCLUSION TRIGGERED",
        containerClass:
          "border-rose-300 bg-gradient-to-r from-rose-700 via-rose-800 to-slate-900 text-white",
        badgeClass: "bg-white/15 text-rose-100 ring-1 ring-white/30",
        icon: XCircle,
      };
    case "escalate_senior":
      return {
        label: "ESCALATED TO SENIOR LICENSED ADJUSTER",
        containerClass:
          "border-amber-300 bg-gradient-to-r from-amber-600 via-amber-700 to-slate-900 text-white",
        badgeClass: "bg-white/20 text-amber-50 ring-1 ring-white/35",
        icon: ShieldAlert,
      };
  }
}

function renderStatusPill(status: LineItemStatus) {
  switch (status) {
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-3 w-3" />
          APPROVED
        </span>
      );
    case "capped":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200">
          <AlertTriangle className="h-3 w-3" />
          CAPPED
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">
          <XCircle className="h-3 w-3" />
          REJECTED
        </span>
      );
    case "escalate":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-200">
          <ShieldAlert className="h-3 w-3" />
          ESCALATE
        </span>
      );
  }
}

export function SettlementReportView({
  report,
  naiveAiEstimateUsd,
  naiveAiFlaw,
  onSelectClause,
}: SettlementReportViewProps) {
  const [copied, setCopied] = useState(false);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);

  const banner = getOutcomeBannerConfig(report.overall_outcome);
  const BannerIcon = banner.icon;
  const isEscalation = report.overall_outcome === "escalate_senior";

  const handleCopyNotice = async () => {
    try {
      await navigator.clipboard.writeText(report.markdown_notice || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback textarea copy
      const el = document.createElement("textarea");
      el.value = report.markdown_notice || "";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Stage Top Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-emerald-600 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
            STEP 3 OF 3
          </span>
          <h2 className="text-xs font-bold tracking-wider text-slate-900 uppercase">
            Official Settlement Decision & Audit Notice
          </h2>
        </div>

        <button
          type="button"
          onClick={handleCopyNotice}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow-xs transition ${
            copied
              ? "bg-emerald-600 text-white"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Copied Settlement Notice!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy Official Settlement Notice</span>
            </>
          )}
        </button>
      </div>

      <div className="space-y-5 p-5">
        {/* High-Impact Outcome Banner */}
        <div className={`rounded-xl border p-4 shadow-xs ${banner.containerClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <BannerIcon className="h-5 w-5 shrink-0" />
              <span className="text-sm font-extrabold tracking-wide">
                {banner.label}
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${banner.badgeClass}`}
            >
              Case {report.case_id} · Deterministic Math Verified
            </span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-white/90">
            {report.executive_summary}
          </p>

          {isEscalation && report.escalation_reason && (
            <div className="mt-3 rounded-lg border border-white/25 bg-black/25 p-3">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-amber-200 uppercase">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Senior Licensed Adjuster Handoff Brief</span>
              </div>
              <p className="text-xs leading-relaxed text-white">
                {report.escalation_reason}
              </p>
            </div>
          )}
        </div>

        {/* 3 High-Contrast KPI Cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* KPI 1: Total Claimed */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              Total Claimed
            </p>
            <p className="mt-1.5 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
              {formatUsd(report.total_claimed_usd)}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {report.line_items.length} itemized claim line
              {report.line_items.length === 1 ? "" : "s"}
            </p>
          </div>

          {/* KPI 2: Approved Payout */}
          <div
            className={`rounded-xl border p-4 ${
              report.overall_outcome === "denied"
                ? "border-rose-200 bg-rose-50/50"
                : isEscalation
                ? "border-slate-200 bg-slate-50/70"
                : "border-emerald-200 bg-emerald-50/40"
            }`}
          >
            <p className="text-[11px] font-bold tracking-wider text-slate-600 uppercase">
              Approved Payout
            </p>
            <p
              className={`mt-1.5 font-mono text-2xl font-extrabold tabular-nums ${
                report.overall_outcome === "denied"
                  ? "text-rose-700"
                  : isEscalation
                  ? "text-slate-800"
                  : "text-emerald-700"
              }`}
            >
              {formatUsd(report.total_approved_usd)}
            </p>
            <p className="mt-1 text-[11px] text-slate-600">
              {isEscalation
                ? "Clerk payout locked at $0.00 pending review"
                : report.overall_outcome === "denied"
                ? "Zero payout under policy exclusion"
                : "Authorized for immediate disbursement"}
            </p>
          </div>

          {/* KPI 3: Dynamic — Escalation Hold vs Leakage Prevented */}
          {isEscalation ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4">
              <div className="flex items-center justify-between gap-1">
                <p className="text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                  Unverified Payout Held for Senior Review
                </p>
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
              </div>
              <p className="mt-1.5 font-mono text-2xl font-extrabold text-amber-900 tabular-nums">
                {formatUsd(
                  report.held_for_review_usd || report.total_claimed_usd
                )}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-amber-800">
                Routed to Senior Underwriter queue with full clause packet
              </p>
            </div>
          ) : (
            <div
              className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4"
              title={naiveAiFlaw || "Overpayment prevented compared to unguided RAG"}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-[11px] font-bold tracking-wider text-emerald-900 uppercase">
                  Leakage Prevented vs. Naive AI
                </p>
                <TrendingDown className="h-4 w-4 shrink-0 text-emerald-600" />
              </div>
              <p className="mt-1.5 font-mono text-2xl font-extrabold text-emerald-800 tabular-nums">
                {formatUsd(report.leakage_prevented_usd)}
              </p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-emerald-900/85">
                {naiveAiFlaw ? (
                  <>
                    {naiveAiEstimateUsd
                      ? `Naive AI est. ${formatUsd(naiveAiEstimateUsd)}: `
                      : ""}
                    {naiveAiFlaw}
                  </>
                ) : (
                  "Saved via Cross-Ref Exclusion & Sub-limit enforcement"
                )}
              </p>
            </div>
          )}
        </div>

        {/* Line-by-Line Adjudication Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="text-[11px] font-bold tracking-wider text-slate-700 uppercase">
              Line-by-Line Policy Adjudication Schedule
            </span>
            <span className="text-[11px] text-slate-500">
              Click any <span className="font-mono font-semibold text-indigo-700">[Clause ID]</span> to inspect legal text in Right Rail
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Line Item</th>
                  <th className="px-3 py-2.5 text-right">Claimed</th>
                  <th className="px-3 py-2.5 text-right">Approved</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Cited Clause</th>
                  <th className="px-4 py-2.5">Adjuster Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {report.line_items.map((item) => (
                  <tr
                    key={item.item_id}
                    className="align-top transition hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <div className="font-mono text-[10px] font-normal text-slate-400">
                        {item.item_id}
                      </div>
                      {item.description}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-600 tabular-nums">
                      {formatUsd(item.claimed_usd)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-slate-950 tabular-nums">
                      {formatUsd(item.approved_usd)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {renderStatusPill(item.status)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {item.clause_id ? (
                        <button
                          type="button"
                          onClick={() => onSelectClause(item.clause_id)}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-100"
                        >
                          <BookOpen className="h-3 w-3" />
                          <span>[{item.clause_id}]</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs leading-relaxed text-slate-700">
                      {item.rationale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer: Copy Official Settlement Notice + Markdown Notice Toggle */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowMarkdownPreview((prev) => !prev)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-950"
            >
              <FileCode2 className="h-4 w-4 text-indigo-600" />
              <span>Audit-Ready Settlement Notice (Markdown)</span>
              {showMarkdownPreview ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>

            <button
              type="button"
              onClick={handleCopyNotice}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold shadow-xs transition ${
                copied
                  ? "bg-emerald-600 text-white"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Official Settlement Notice</span>
                </>
              )}
            </button>
          </div>

          {showMarkdownPreview && (
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-800">
              {report.markdown_notice}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
}
