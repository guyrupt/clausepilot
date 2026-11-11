"use client";

import React, { useState, useRef } from "react";
import {
  Upload,
  Search,
  GitBranch,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Link2,
  BookOpen,
  Filter,
  Sparkles,
} from "lucide-react";
import type {
  PolicyCategory,
  PolicyChunk,
  PolicyDocumentSummary,
  RetrievalHit,
} from "@/lib/types";
import { searchPolicies, uploadPolicy } from "@/lib/api";
import { getCategoryPillStyle } from "./RagTracePanel";

interface KnowledgeBaseViewProps {
  documents: PolicyDocumentSummary[];
  chunks: PolicyChunk[];
  onPolicyUploaded: () => Promise<void>;
}

const PRESET_QUERIES = [
  {
    label: "Typhoon Hotel + Draft Beer Trap",
    query: "Tokyo hotel and draft beer during typhoon delay",
    trapHint:
      "Watch Section 24.3 ($150/night hotel cap & alcohol exclusion) auto-link from Section 24.1!",
  },
  {
    label: "Taipei Arrival Baggage Trap",
    query: "delayed baggage arriving back in Taipei",
    trapHint:
      "Watch Article 27.2 (Home-Country Arrival Exclusion) auto-link from Article 26!",
  },
  {
    label: "Separate-PNR Missed Connection",
    query: "missed connection booked on two separate airline tickets",
    trapHint:
      "Surfaces Section 21.4 Single-PNR Conjunction Ticket requirement & escalation rule.",
  },
];

export function KnowledgeBaseView({
  documents,
  chunks,
  onPolicyUploaded,
}: KnowledgeBaseViewProps) {
  // Uploader state
  const [customTitle, setCustomTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] =
    useState<PolicyDocumentSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hybrid RAG Playground state
  const [query, setQuery] = useState(PRESET_QUERIES[0].query);
  const [expandCrossRefs, setExpandCrossRefs] = useState(true);
  const [searchHits, setSearchHits] = useState<RetrievalHit[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Full Clause Browser state
  const [browserFilterText, setBrowserFilterText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PolicyCategory | "all">(
    "all"
  );

  const totalCrossRefEdges = documents.reduce(
    (sum, d) => sum + (d.cross_ref_edges || 0),
    0
  );

  const handleFileUpload = async (file: File) => {
    if (!/\.(pdf|md|txt|markdown)$/i.test(file.name)) {
      setUploadError("Please upload a .pdf, .md, or .txt policy document.");
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const summary = await uploadPolicy(file, customTitle);
      setUploadSuccess(summary);
      setCustomTitle("");
      await onPolicyUploaded();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Failed to ingest policy document."
      );
    } finally {
      setIsUploading(false);
    }
  };

  const runSearch = async (targetQuery: string, targetExpand: boolean) => {
    if (!targetQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await searchPolicies(targetQuery.trim(), 6, targetExpand);
      setSearchHits(res.hits || []);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Policy search failed."
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleExpand = async () => {
    const nextVal = !expandCrossRefs;
    setExpandCrossRefs(nextVal);
    if (query.trim()) {
      await runSearch(query, nextVal);
    }
  };

  const filteredChunks = chunks.filter((c) => {
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    if (!browserFilterText.trim()) return true;
    const q = browserFilterText.toLowerCase();
    return (
      c.clause_id.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.text.toLowerCase().includes(q) ||
      c.doc_title.toLowerCase().includes(q)
    );
  });

  const autoLinkedHitsCount = (searchHits || []).filter(
    (h) => h.retrieval_reason === "cross_ref_expansion"
  ).length;

  return (
    <div className="mx-auto max-w-[1520px] space-y-6 px-4 py-6 lg:px-6">
      {/* Section 1: Ground-Truth Policy Index + Live PDF/MD Uploader */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Indexed Documents Summary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="rounded bg-emerald-600 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white uppercase">
                GROUND-TRUTH CORPUS
              </span>
              <h2 className="mt-1.5 text-base font-bold text-slate-950">
                Indexed Insurance Policy Documents & Cross-Reference Graph
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right">
                <p className="text-[10px] font-semibold text-slate-500 uppercase">
                  Indexed Clauses
                </p>
                <p className="font-mono text-sm font-extrabold text-slate-900 tabular-nums">
                  {chunks.length}
                </p>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-right">
                <p className="text-[10px] font-semibold text-indigo-700 uppercase">
                  Cross-Ref Edges
                </p>
                <p className="font-mono text-sm font-extrabold text-indigo-900 tabular-nums">
                  {totalCrossRefEdges}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {documents.map((doc) => (
              <div
                key={doc.doc_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {doc.title}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-500">
                      {doc.filename} · ID: {doc.doc_id}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-slate-800 ring-1 ring-slate-200">
                    {doc.chunk_count} chunks
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700 ring-1 ring-indigo-200">
                    <GitBranch className="h-3 w-3" />
                    {doc.cross_ref_edges} edges
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Drag-and-Drop Policy Uploader */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5">
          <h3 className="text-sm font-bold text-slate-950">
            Ingest Additional Policy (.PDF / .MD / .TXT)
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Automatically splits articles/sections, embeds via{" "}
            <span className="font-mono text-slate-700">bge-small-en-v1.5</span>,
            and wires bidirectional &amp; sibling exclusion edges.
          </p>

          <div className="mt-3">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Optional policy title override (e.g., 2026 Corporate Rider)"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15 focus:outline-none"
            />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFileUpload(file);
            }}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition ${
              isDragging
                ? "border-indigo-600 bg-indigo-50/70"
                : "border-slate-300 bg-slate-50/70 hover:border-indigo-400 hover:bg-slate-50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.txt,.markdown"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
                e.target.value = "";
              }}
              className="hidden"
            />

            {isUploading ? (
              <div className="flex flex-col items-center py-1">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                <p className="mt-2 text-xs font-semibold text-indigo-900">
                  Chunking Clauses & Computing ONNX Embeddings...
                </p>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-6 w-6 text-indigo-600" />
                <p className="mt-1.5 text-xs font-semibold text-slate-800">
                  Drag &amp; drop policy <span className="font-mono">.pdf</span>,{" "}
                  <span className="font-mono">.md</span>, or{" "}
                  <span className="font-mono">.txt</span>, or{" "}
                  <span className="text-indigo-600 underline">browse</span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Instant local indexing · Zero external vector DB required
                </p>
              </>
            )}
          </div>

          {uploadSuccess && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Indexed <strong>{uploadSuccess.title}</strong> (
                {uploadSuccess.chunk_count} clauses,{" "}
                {uploadSuccess.cross_ref_edges} cross-ref edges).
              </span>
            </div>
          )}

          {uploadError && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {uploadError}
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Interactive Hybrid RAG vs. Cross-Ref Exclusion Studio */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-600 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white uppercase">
                LIVE RETRIEVAL BENCHMARK
              </span>
              <h2 className="text-base font-bold text-slate-950">
                Hybrid RAG vs. Cross-Reference Exclusion Graph Tester
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Toggle{" "}
              <span className="font-semibold text-slate-900">
                Expand Cross-Referenced Exclusions
              </span>{" "}
              ON and OFF to demonstrate why naive top-K retrieval misses{" "}
              <span className="font-mono font-semibold text-rose-700">
                Section 24.3
              </span>{" "}
              and{" "}
              <span className="font-mono font-semibold text-rose-700">
                Article 27.2
              </span>
              .
            </p>
          </div>

          {/* Interactive Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={expandCrossRefs}
            onClick={() => void handleToggleExpand()}
            className={`flex items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition ${
              expandCrossRefs
                ? "border-indigo-300 bg-indigo-50/80 text-indigo-950"
                : "border-amber-300 bg-amber-50/80 text-amber-950"
            }`}
          >
            <div
              className={`relative h-5 w-9 rounded-full transition ${
                expandCrossRefs ? "bg-indigo-600" : "bg-slate-400"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-all ${
                  expandCrossRefs ? "left-4.5" : "left-0.5"
                }`}
              />
            </div>
            <div>
              <p className="text-xs font-bold">
                Expand Cross-Referenced Exclusions:{" "}
                <span
                  className={
                    expandCrossRefs ? "text-indigo-700" : "text-amber-800"
                  }
                >
                  {expandCrossRefs ? "ON" : "OFF (Naive Top-K)"}
                </span>
              </p>
              <p className="text-[10px] text-slate-600">
                Bidirectional + sibling sub-limit graph traversal
              </p>
            </div>
          </button>
        </div>

        {/* Preset Query Pills */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">
            1-Click Demo Queries:
          </span>
          {PRESET_QUERIES.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setQuery(preset.query);
                void runSearch(preset.query, expandCrossRefs);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                query === preset.query
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>

        {/* Search Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query, expandCrossRefs);
          }}
          className="mt-3 flex flex-col gap-2.5 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter any claim scenario or clause keyword (English or CJK e.g. 生ビール, 班機延誤)..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-4 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-slate-800 disabled:opacity-50"
          >
            {isSearching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="h-4 w-4 text-indigo-400" />
                <span>Run Hybrid Search</span>
              </>
            )}
          </button>
        </form>

        {searchError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {searchError}
          </div>
        )}

        {/* Comparison Status Callout when results exist */}
        {searchHits !== null && (
          <div className="mt-4 space-y-3">
            {!expandCrossRefs ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-950">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <strong>Cross-Reference Graph is OFF:</strong> Showing pure
                  top-K hybrid similarity only. Sibling sub-limits (e.g.,{" "}
                  <code className="font-mono font-bold">Section 24.3</code>) or
                  backward-referenced exclusions (e.g.,{" "}
                  <code className="font-mono font-bold">Article 27.2</code>) can
                  drop out when the query only describes covered items!
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs text-emerald-950">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  <strong>Cross-Reference Graph is ON:</strong> Retrieved{" "}
                  <strong>{searchHits.length}</strong> clauses including{" "}
                  <strong>
                    {autoLinkedHitsCount} auto-linked exclusion / sub-limit
                    clause{autoLinkedHitsCount === 1 ? "" : "s"}
                  </strong>{" "}
                  via bidirectional &amp; sibling graph edges.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {searchHits.map((hit, idx) => {
                const isCrossRef =
                  hit.retrieval_reason === "cross_ref_expansion";
                return (
                  <div
                    key={hit.chunk.chunk_id}
                    className={`rounded-xl border p-4 ${
                      isCrossRef
                        ? "border-rose-300 bg-rose-50/30"
                        : "border-slate-200 bg-slate-50/40"
                    }`}
                  >
                    {isCrossRef && (
                      <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white">
                        <Link2 className="h-3 w-3" />
                        <span>
                          AUTO-LINKED EXCLUSION (from{" "}
                          {hit.linked_from || hit.chunk.parent_article})
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-sm font-extrabold text-slate-950">
                          {hit.chunk.clause_id}
                        </span>
                      </div>
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${getCategoryPillStyle(
                          hit.chunk.category
                        )}`}
                      >
                        {hit.chunk.category}
                      </span>
                    </div>

                    <h4 className="mt-1 text-xs font-bold text-slate-900">
                      {hit.chunk.title}
                    </h4>

                    <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] tabular-nums">
                      <span>
                        <span className="text-slate-400">Cosine:</span>{" "}
                        <strong>{hit.cosine_score.toFixed(3)}</strong>
                      </span>
                      <span>
                        <span className="text-slate-400">BM25:</span>{" "}
                        <strong>{hit.bm25_score.toFixed(2)}</strong>
                      </span>
                      <span>
                        <span className="text-slate-400">RRF:</span>{" "}
                        <strong className="text-indigo-700">
                          {hit.rrf_score.toFixed(4)}
                        </strong>
                      </span>
                    </div>

                    <p className="mt-2.5 line-clamp-4 text-xs leading-relaxed text-slate-700">
                      {hit.chunk.text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Full Policy Chunk Browser */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-950">
              Indexed Policy Clause & Cross-Reference Browser (
              {filteredChunks.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Filter className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={browserFilterText}
                onChange={(e) => setBrowserFilterText(e.target.value)}
                placeholder="Filter clauses..."
                className="rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            {(
              [
                "all",
                "coverage",
                "exclusion",
                "sublimit",
                "definition",
                "general",
              ] as const
            ).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase transition ${
                  categoryFilter === cat
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredChunks.map((chunk) => (
            <div
              key={chunk.chunk_id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/40 p-4 transition hover:border-slate-300 hover:bg-white"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-extrabold text-indigo-950">
                    {chunk.clause_id}
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${getCategoryPillStyle(
                      chunk.category
                    )}`}
                  >
                    {chunk.category}
                  </span>
                </div>

                <h3 className="mt-1 text-xs font-bold text-slate-900">
                  {chunk.title}
                </h3>
                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                  {chunk.doc_title} · Parent: {chunk.parent_article}
                </p>

                <p className="mt-2.5 text-xs leading-relaxed text-slate-700 whitespace-pre-line">
                  {chunk.text}
                </p>
              </div>

              {chunk.cross_refs && chunk.cross_refs.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-200/80 pt-2.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Cross-Refs:
                  </span>
                  {chunk.cross_refs.map((ref) => (
                    <button
                      key={ref}
                      type="button"
                      onClick={() => setBrowserFilterText(ref)}
                      className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      → {ref}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
