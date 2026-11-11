"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  Image as ImageIcon,
  Loader2,
  Trash2,
  FilePlus2,
} from "lucide-react";
import { uploadClaim } from "@/lib/api";
import type { ClaimCase } from "@/lib/types";

interface NewClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (created: ClaimCase) => void;
}

export function NewClaimModal({
  isOpen,
  onClose,
  onCreated,
}: NewClaimModalProps) {
  const [title, setTitle] = useState("");
  const [route, setRoute] = useState("TPE → NRT");
  const [narrative, setNarrative] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((f) =>
      /\.(png|jpe?g|webp)$/i.test(f.name)
    );
    if (valid.length === 0 && incoming.length > 0) {
      setError("Please upload .png, .jpg, or .webp receipt/certificate images.");
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...valid]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !narrative.trim()) {
      setError("Claim Title and Passenger Narrative are required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await uploadClaim({
        title: title.trim(),
        route: route.trim() || "TPE → NRT",
        narrative: narrative.trim(),
        files,
      });
      setTitle("");
      setRoute("TPE → NRT");
      setNarrative("");
      setFiles([]);
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload claim.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
              <FilePlus2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-950">
                New Claim Packet
              </h3>
              <p className="text-xs text-slate-500">
                Ingest narrative + receipt PNGs for Gemini 3.8 Vision & Hybrid RAG
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Field 1: Claim Title */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-800">
              Claim Title <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Osaka Typhoon Delay — Overnight Hotel & Meals"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15 focus:outline-none"
              required
            />
          </div>

          {/* Field 2: Route */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-800">
              Flight Route <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              placeholder="e.g., KIX → TPE"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15 focus:outline-none"
              required
            />
          </div>

          {/* Field 3: Narrative */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-800">
              Passenger Narrative & Claim Context{" "}
              <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Describe the flight disruption, delay duration, policy purchase timing, and claimed expenses..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15 focus:outline-none"
              required
            />
          </div>

          {/* Multi-Image Dropzone */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-800">
              Evidence Images (Receipts / Delay Certificates)
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition ${
                isDragging
                  ? "border-indigo-600 bg-indigo-50/60"
                  : "border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
                className="hidden"
              />
              <Upload className="mx-auto mb-1.5 h-5 w-5 text-indigo-600" />
              <p className="text-xs font-semibold text-slate-800">
                Drop .png, .jpg, or .webp receipts here, or{" "}
                <span className="text-indigo-600 underline">browse files</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Batch-processed by GMI Cloud Gemini 3.8 Flash Multimodal Vision
              </p>
            </div>

            {files.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {files.map((file, idx) => (
                  <li
                    key={`${file.name}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                  >
                    <span className="flex items-center gap-2 truncate font-medium text-slate-800">
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                      <span className="truncate">{file.name}</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        ({(file.size / 1024).toFixed(0)} KB)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Uploading Packet...</span>
                </>
              ) : (
                <span>Create & Open Claim</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
