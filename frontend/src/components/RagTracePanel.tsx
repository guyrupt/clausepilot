"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  GitBranch,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Link2,
  Layers,
} from "lucide-react";
import type { PolicyCategory, RetrievalHit } from "@/lib/types";
import { chunkMatchesClauseRef } from "@/lib/api";

interface RagTracePanelProps {
  queriesExecuted: string[];
  hits: RetrievalHit[];
  highlightedClauseRef: string | null;
  highlightSeq: number;
}

type TraceFilter = "all" | "cross_ref" | "hybrid";

export function getCategoryPillStyle(category: PolicyCategory): string {
  switch (category) {
    case "coverage":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "exclusion":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "sublimit":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "definition":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export function RagTracePanel({
  queriesExecuted,
  hits,
  highlightedClauseRef,
  highlightSeq,
}: RagTracePanelProps) {
  const [filter, setFilter] = useState<TraceFilter>("all");
  const [expandedOverrides, setExpandedOverrides] = useState<
    Record<string, boolean>
  >({});
  const [showQueries, setShowQueries] = useState(true);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Pure DOM scroll effect when a [clause_id] badge is clicked in Stage 2 or Stage 3
  useEffect(() => {
    if (!highlightedClauseRef || hits.length === 0) return;
    const match = hits.find((h) =>
      chunkMatchesClauseRef(h.chunk, highlightedClauseRef)
    );
    if (!match) return;

    const timer = setTimeout(() => {
      const el = cardRefs.current[match.chunk.chunk_id];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [highlightedClauseRef, highlightSeq, hits]);

  const crossRefCount = hits.filter(
    (h) => h.retrieval_reason === "cross_ref_expansion"
  ).length;
  const hybridCount = hits.length - crossRefCount;

  const filteredHits = hits.filter((h) => {
    if (chunkMatchesClauseRef(h.chunk, highlightedClauseRef)) return true;
    if (filter === "cross_ref")
      return h.retrieval_reason === "cross_ref_expansion";
    if (filter === "hybrid") return h.retrieval_reason === "hybrid_match";
    return true;
  });

  const toggleExpand = (chunkId: string, currentlyExpanded: boolean) => {
    setExpandedOverrides((prev) => ({
      ...prev,
      [chunkId]: !currentlyExpanded,
    }));
  };

  return (
    <aside className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)]">
      {/* Panel Header */}
      <div className="rounded-t-2xl border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-indigo-400" />
            <h2 className="text-xs font-bold tracking-wider uppercase">
              Hybrid RAG & Cross-Ref Trace
            </h2>
          </div>
          <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-200 tabular-nums">
            {hits.length} clauses
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-300">
          Dense ONNX Cosine + CJK/Clause BM25 RRF + Bidirectional Exclusion Graph
        </p>
      </div>

      {hits.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
            <Layers className="h-5 w-5" />
          </div>
          <p className="text-xs font-bold text-slate-800">
            RAG Retrieval Trace Standby
          </p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
            Click{" "}
            <span className="font-semibold text-indigo-700">
              Analyze Claim &amp; Run Hybrid RAG
            </span>{" "}
            to inspect live Cosine, BM25, RRF scores, and auto-linked exclusions.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Executed Multi-Queries + Filter Bar */}
          <div className="space-y-2.5 border-b border-slate-200 bg-slate-50/90 px-4 py-3">
            {queriesExecuted.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowQueries((s) => !s)}
                  className="flex w-full items-center justify-between text-[11px] font-bold tracking-wide text-slate-600 uppercase hover:text-slate-900"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Search className="h-3 w-3 text-indigo-600" />
                    Deterministic Search Queries ({queriesExecuted.length})
                  </span>
                  {showQueries ? (
                    <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  )}
                </button>

                {showQueries && (
                  <ul className="mt-1.5 space-y-1">
                    {queriesExecuted.map((q, idx) => (
                      <li
                        key={`${idx}-${q}`}
                        className="truncate rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-700"
                        title={q}
                      >
                        <span className="mr-1.5 font-bold text-indigo-600">
                          Q{idx + 1}
                        </span>
                        {q}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Filter Tabs */}
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded py-1 transition ${
                  filter === "all"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                All ({hits.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("cross_ref")}
                className={`rounded py-1 transition ${
                  filter === "cross_ref"
                    ? "bg-rose-600 text-white"
                    : "text-rose-700 hover:bg-rose-50"
                }`}
              >
                Auto-Linked ({crossRefCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("hybrid")}
                className={`rounded py-1 transition ${
                  filter === "hybrid"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Hybrid ({hybridCount})
              </button>
            </div>
          </div>

          {/* Ranked Clause Cards */}
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
            {filteredHits.map((hit, idx) => {
              const { chunk } = hit;
              const isCrossRef = hit.retrieval_reason === "cross_ref_expansion";
              const isHighlighted = chunkMatchesClauseRef(
                chunk,
                highlightedClauseRef
              );
              const defaultExpanded = idx < 2 || isCrossRef;
              const isExpanded =
                isHighlighted ||
                (expandedOverrides[chunk.chunk_id] ?? defaultExpanded);

              return (
                <div
                  key={chunk.chunk_id}
                  ref={(el) => {
                    cardRefs.current[chunk.chunk_id] = el;
                  }}
                  className={`rounded-xl border transition-all ${
                    isHighlighted
                      ? "border-indigo-600 bg-indigo-50/40 shadow-md ring-2 ring-indigo-600/30"
                      : isCrossRef
                      ? "border-rose-300 bg-rose-50/25 hover:border-rose-400"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(chunk.chunk_id, isExpanded)}
                    className="w-full p-3 text-left"
                  >
                    {/* Auto-Linked Exclusion Callout Badge */}
                    {isCrossRef && (
                      <div className="mb-2 flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-600 px-2 py-1 text-[10px] font-extrabold tracking-wide text-white shadow-2xs">
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span>
                          AUTO-LINKED EXCLUSION (from{" "}
                          {hit.linked_from || chunk.parent_article})
                        </span>
                      </div>
                    )}

                    {/* Clause ID + Category Pill */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-xs font-extrabold text-slate-950">
                          {chunk.clause_id}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getCategoryPillStyle(
                            chunk.category
                          )}`}
                        >
                          {chunk.category}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {/* Clause Title */}
                    <p className="mt-1 text-xs font-semibold text-slate-800">
                      {chunk.title}
                    </p>

                    {/* Cosine / BM25 / RRF Score Strip */}
                    <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50 px-2 py-1 font-mono text-[10px] tabular-nums">
                      <div>
                        <span className="text-slate-400">Cosine </span>
                        <span className="font-bold text-slate-800">
                          {hit.cosine_score.toFixed(3)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">BM25 </span>
                        <span className="font-bold text-slate-800">
                          {hit.bm25_score.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">RRF </span>
                        <span className="font-bold text-indigo-700">
                          {hit.rrf_score.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Full Legal Text */}
                  {isExpanded && (
                    <div className="rounded-b-xl border-t border-slate-200/80 bg-white/90 px-3 py-2.5">
                      <p className="text-[11.5px] leading-relaxed whitespace-pre-line text-slate-700">
                        {chunk.text}
                      </p>

                      {chunk.cross_refs && chunk.cross_refs.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                            <Sparkles className="h-2.5 w-2.5 text-indigo-500" />
                            Graph Edges:
                          </span>
                          {chunk.cross_refs.map((ref) => (
                            <span
                              key={ref}
                              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700"
                            >
                              {ref}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
