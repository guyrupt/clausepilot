"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  X,
  CalendarClock,
  AlertCircle,
  PlaneTakeoff,
  FileText,
  Receipt,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  User,
} from "lucide-react";
import type {
  AnalyzeClaimResponse,
  ClaimCase,
  EvidenceFile,
} from "@/lib/types";
import { formatRoute, formatUsd, resolveEvidenceUrl } from "@/lib/api";

interface EvidenceViewerProps {
  claim: ClaimCase;
  analysis: AnalyzeClaimResponse | null;
  isAnalyzing: boolean;
  isRescanningOcr: boolean;
  onAnalyze: (forceOcr: boolean) => void;
}

export function EvidenceViewer({
  claim,
  analysis,
  isAnalyzing,
  isRescanningOcr,
  onAnalyze,
}: EvidenceViewerProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isZoomed150, setIsZoomed150] = useState(false);

  const evidenceList: EvidenceFile[] = claim.evidence_files || [];
  const activeEvidence =
    lightboxIndex !== null && evidenceList[lightboxIndex]
      ? evidenceList[lightboxIndex]
      : null;

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxIndex(null);
        setIsZoomed150(false);
      } else if (e.key === "ArrowRight" && evidenceList.length > 1) {
        setLightboxIndex((prev) =>
          prev === null ? null : (prev + 1) % evidenceList.length
        );
      } else if (e.key === "ArrowLeft" && evidenceList.length > 1) {
        setLightboxIndex((prev) =>
          prev === null
            ? null
            : (prev - 1 + evidenceList.length) % evidenceList.length
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, evidenceList.length]);

  const displayedItems = analysis
    ? analysis.extracted_items
    : claim.pre_extracted_items || [];

  const totalClaimed = displayedItems.reduce(
    (sum, item) => sum + (Number(item.claimed_usd) || 0),
    0
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xs">
      {/* Stage Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
            STAGE 01
          </span>
          <h2 className="text-xs font-bold tracking-wider text-slate-900 uppercase">
            Claim Brief & Multimodal Evidence
          </h2>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
            <User className="h-3.5 w-3.5 text-slate-400" />
            {claim.claimant_name || "Policyholder"}
          </span>
          <span className="text-slate-300">·</span>
          <span className="font-mono font-semibold text-indigo-700">
            {claim.case_id}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Title & Flight Context */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-950">
              {claim.title}
            </h1>
            {claim.subtitle && (
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {claim.subtitle}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-mono text-xs font-bold text-indigo-900">
              <PlaneTakeoff className="h-3.5 w-3.5 text-indigo-600" />
              {formatRoute(claim.route)}
            </span>
            {claim.flight_number && (
              <span className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-800">
                {claim.flight_number}
              </span>
            )}
            {claim.delay_hours > 0 && (
              <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-xs font-bold text-amber-900 tabular-nums">
                {Number(claim.delay_hours.toFixed(2))}h Delay
              </span>
            )}
          </div>
        </div>

        {/* Policy Purchase Timestamp vs Incident Timestamp Grid */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <CalendarClock className="h-3.5 w-3.5 text-emerald-600" />
              <span>Policy Purchased At</span>
            </div>
            <p className="mt-1 font-mono text-xs font-bold text-slate-900">
              {claim.policy_purchased_at || "Verified Prior to Departure"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
              <span>Disruption / Incident Timestamp</span>
            </div>
            <p className="mt-1 font-mono text-xs font-bold text-slate-900">
              {claim.incident_time || "Reported Upon Disruption"}
            </p>
          </div>
        </div>

        {/* Passenger Narrative */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-500 uppercase">
            <FileText className="h-3.5 w-3.5 text-slate-400" />
            <span>Claimant Statement</span>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-700">
            {claim.narrative}
          </p>
        </div>

        {/* Multimodal Evidence Thumbnails (Standard HTML <img> tags per contract) */}
        {evidenceList.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                Attached Documentary Evidence ({evidenceList.length})
              </span>
              <span className="text-[11px] text-slate-500">
                Click any document to inspect full-resolution scan
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {evidenceList.map((ev, idx) => {
                const imgSrc = resolveEvidenceUrl(ev.url);
                return (
                  <button
                    key={`${ev.filename}-${idx}`}
                    type="button"
                    onClick={() => {
                      setLightboxIndex(idx);
                      setIsZoomed150(false);
                    }}
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left transition hover:border-indigo-400 hover:shadow-md"
                  >
                    <div className="relative h-44 w-full overflow-hidden bg-slate-200/70">
                      <img
                        src={imgSrc}
                        alt={ev.label || ev.filename}
                        className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
                        loading="eager"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-950/0 transition group-hover:bg-slate-950/30">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-sm transition group-hover:opacity-100">
                          <ZoomIn className="h-3.5 w-3.5" />
                          Inspect Scan
                        </span>
                      </div>
                    </div>

                    <div className="flex w-full items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {ev.label || ev.filename}
                        </p>
                        <p className="truncate font-mono text-[10px] text-slate-400">
                          {ev.filename}
                        </p>
                      </div>
                      <ZoomIn className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-indigo-600" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary Analyze CTA + Subtle Live Gemini 3.8 Re-scan Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 via-slate-50 to-white p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onAnalyze(false)}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-65"
            >
              {isAnalyzing && !isRescanningOcr ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Running Vision OCR + Hybrid RAG...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {analysis
                      ? "Re-run Claim Analysis & Hybrid RAG"
                      : "Analyze Claim & Run Hybrid RAG"}
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onAnalyze(true)}
              disabled={isAnalyzing}
              title="Bypass SHA-256 disk cache and execute live GMI Cloud Gemini 3.8 Flash Vision OCR"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-800 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRescanningOcr ? "animate-spin text-indigo-600" : "text-slate-500"
                }`}
              />
              <span>
                {isRescanningOcr
                  ? "Scanning Live with Gemini 3.8..."
                  : "Re-scan Live with Gemini 3.8 Vision"}
              </span>
            </button>
          </div>

          {analysis && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${
                analysis.vision_cached
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              {analysis.vision_cached
                ? "SHA-256 Vision Cache Hit"
                : "Live Gemini 3.8 Vision Verified"}
            </span>
          )}
        </div>

        {/* Vision Summary & Parsed Line-Item Table */}
        {(analysis || displayedItems.length > 0) && (
          <div className="space-y-3 pt-1">
            {analysis?.vision_summary && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3.5 py-2.5">
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-indigo-800 uppercase">
                  <Sparkles className="h-3 w-3 text-indigo-600" />
                  <span>Gemini 3.8 Vision Evidence Extraction Summary</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-700">
                  {analysis.vision_summary}
                </p>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-700 uppercase">
                  <Receipt className="h-3.5 w-3.5 text-slate-500" />
                  {analysis
                    ? "Vision-Verified Claimed Line Items"
                    : "Claimed Line Items (Pending Hybrid Analysis)"}
                </span>
                <span className="font-mono text-[11px] font-semibold text-slate-500">
                  {displayedItems.length} item{displayedItems.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold text-slate-500 uppercase">
                      <th className="px-3.5 py-2">Item</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Original Receipt</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3.5 py-2 text-right">Claimed (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {displayedItems.map((item) => (
                      <tr key={item.item_id} className="hover:bg-slate-50/70">
                        <td className="px-3.5 py-2.5 font-medium text-slate-900">
                          <span className="mr-1.5 font-mono text-[10px] text-slate-400">
                            {item.item_id}
                          </span>
                          {item.description}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700">
                            {item.category}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600 tabular-nums">
                          {item.original_amount}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">
                          {item.source_doc}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {formatUsd(item.claimed_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/90 font-semibold">
                      <td
                        colSpan={4}
                        className="px-3.5 py-2 text-right text-xs text-slate-600"
                      >
                        Total Claimed Amount
                      </td>
                      <td className="px-3.5 py-2 text-right font-mono text-sm font-bold text-slate-950 tabular-nums">
                        {formatUsd(totalClaimed)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Crisp Zoom Lightbox Modal */}
      {activeEvidence && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
          onClick={() => {
            setLightboxIndex(null);
            setIsZoomed150(false);
          }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Lightbox Toolbar */}
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {activeEvidence.label || activeEvidence.filename}
                </p>
                <p className="truncate font-mono text-[11px] text-slate-400">
                  {activeEvidence.filename} · Document {(lightboxIndex ?? 0) + 1}{" "}
                  of {evidenceList.length}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {evidenceList.length > 1 && (
                  <div className="flex items-center gap-1 mr-1">
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxIndex((prev) =>
                          prev === null
                            ? 0
                            : (prev - 1 + evidenceList.length) %
                              evidenceList.length
                        )
                      }
                      className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700"
                      title="Previous document"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxIndex((prev) =>
                          prev === null ? 0 : (prev + 1) % evidenceList.length
                        )
                      }
                      className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700"
                      title="Next document"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setIsZoomed150((z) => !z)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  {isZoomed150 ? (
                    <>
                      <ZoomOut className="h-3.5 w-3.5" />
                      <span>Fit Screen</span>
                    </>
                  ) : (
                    <>
                      <ZoomIn className="h-3.5 w-3.5" />
                      <span>150% Zoom</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLightboxIndex(null);
                    setIsZoomed150(false);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-rose-600 hover:border-rose-500 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Image Canvas */}
            <div className="flex-1 overflow-auto bg-slate-950 p-6">
              <div className="flex min-h-full items-center justify-center">
                <img
                  src={resolveEvidenceUrl(activeEvidence.url)}
                  alt={activeEvidence.label || activeEvidence.filename}
                  className={`rounded-lg bg-white shadow-lg transition-all ${
                    isZoomed150
                      ? "w-[130%] max-w-none"
                      : "max-h-[75vh] w-auto max-w-full object-contain"
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
