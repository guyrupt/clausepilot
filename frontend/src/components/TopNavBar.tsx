"use client";

import React from "react";
import {
  ShieldCheck,
  Database,
  Briefcase,
  Cpu,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import type { HealthResponse } from "@/lib/types";

export type AppMode = "workbench" | "knowledge_base";

interface TopNavBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  health: HealthResponse | null;
  healthError: boolean;
  onRefreshHealth: () => void;
}

export function TopNavBar({
  mode,
  onModeChange,
  health,
  healthError,
  onRefreshHealth,
}: TopNavBarProps) {
  const isOnline = Boolean(health && health.status === "ok" && !healthError);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        {/* Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm ring-1 ring-slate-900/10">
            <ShieldCheck className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold tracking-tight text-slate-950">
                ClausePilot
              </span>
              <span className="hidden rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-indigo-700 sm:inline-block">
                YC RFS · $15/HR EXPERT
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500">
              Turn $15/hr Support Reps into Licensed Claims Adjusters
            </p>
          </div>
        </div>

        {/* Segmented Mode Switch */}
        <nav
          aria-label="Workspace mode"
          className="flex items-center rounded-lg border border-slate-200 bg-slate-100/90 p-1"
        >
          <button
            type="button"
            onClick={() => onModeChange("workbench")}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              mode === "workbench"
                ? "bg-white text-slate-950 shadow-xs ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Briefcase className="h-3.5 w-3.5 text-indigo-600" />
            <span>Guided Claims Workbench</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange("knowledge_base")}
            className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              mode === "knowledge_base"
                ? "bg-white text-slate-950 shadow-xs ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Database className="h-3.5 w-3.5 text-emerald-600" />
            <span>Policy Knowledge Base (RAG Studio)</span>
          </button>
        </nav>

        {/* Live Engine Status Pill */}
        <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700 xl:flex">
          <span className="relative flex h-2 w-2">
            {isOnline && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isOnline
                  ? "bg-emerald-500"
                  : healthError
                  ? "bg-rose-500"
                  : "bg-amber-400"
              }`}
            />
          </span>

          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-700">
            <Cpu className="h-3 w-3 text-slate-500" />
            bge-small-en-v1.5 ONNX
          </span>

          <span className="text-slate-300">|</span>

          <span className="inline-flex items-center gap-1 text-slate-700">
            <Sparkles className="h-3 w-3 text-indigo-600" />
            GMI Cloud (Gemini 3.8 Vision + DeepSeek V4.1)
          </span>

          <span className="text-slate-300">|</span>

          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-900 ring-1 ring-slate-200 tabular-nums">
            {health ? `${health.chunk_count} chunks` : "Connecting..."}
          </span>

          {healthError && (
            <button
              type="button"
              onClick={onRefreshHealth}
              title="Retry backend health check"
              className="ml-0.5 rounded p-0.5 text-rose-600 hover:bg-rose-50"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
