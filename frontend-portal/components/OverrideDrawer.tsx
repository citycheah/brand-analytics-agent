"use client";

import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AVAILABLE_CATEGORIES, AVAILABLE_THEMES, postOverride } from "@/lib/api";
import {
  BRAND_LIST,
  type CreativeItem,
  type OverridePayload,
  type OverrideResponse,
} from "@/lib/types";

interface OverrideDrawerProps {
  item: CreativeItem | null;
  onClose: () => void;
  onApplied: (res: OverrideResponse) => void;
}

type EditableField = "matched_brand_id" | "theme_label" | "category";

export function OverrideDrawer({ item, onClose, onApplied }: OverrideDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [fieldName, setFieldName] = useState<EditableField>("matched_brand_id");
  const [humanValue, setHumanValue] = useState("");
  const [reviewer, setReviewer] = useState("A. Hoffmann");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync <dialog> modal open/close state and native close event + Safari closedby fallback
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onCloseRef.current();
    };
    dialog.addEventListener("close", handleClose);

    // Safari fallback for closedby="any" light dismiss
    let cleanupFallback: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = outside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && outside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      cleanupFallback = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      cleanupFallback?.();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (item) {
      setFieldName("matched_brand_id");
      setHumanValue(item.matched_brand_id);
      setReason("");
      setErrorMsg(null);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [item]);

  const currentAiValue = item
    ? fieldName === "matched_brand_id"
      ? item.matched_brand_id
      : fieldName === "theme_label"
        ? item.theme_label
        : item.category
    : "";

  const handleFieldChange = (nextField: EditableField) => {
    if (!item) return;
    setFieldName(nextField);
    setErrorMsg(null);
    if (nextField === "matched_brand_id") {
      setHumanValue(item.matched_brand_id);
    } else if (nextField === "theme_label") {
      setHumanValue(item.theme_label);
    } else {
      setHumanValue(item.category);
    }
  };

  const handleRequestClose = () => {
    dialogRef.current?.close();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setErrorMsg(null);

    if (!humanValue.trim()) {
      setErrorMsg("Select or enter a verified human value.");
      return;
    }
    if (!reviewer.trim()) {
      setErrorMsg("Reviewer name is required for audit compliance.");
      return;
    }
    if (reason.trim().length < 5) {
      setErrorMsg("Provide a concise audit reason (at least 5 characters).");
      return;
    }

    setSubmitting(true);
    try {
      const payload: OverridePayload = {
        target_key_type: "asset_id",
        target_key_value: item.asset_id,
        field_name: fieldName,
        human_value: humanValue.trim(),
        reviewer: reviewer.trim(),
        reason: reason.trim(),
        ai_value: currentAiValue,
      };
      const res = await postOverride(payload);
      onApplied(res);
      dialogRef.current?.close();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to save override."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="override-drawer-title"
      {...({ closedby: "any" } as Record<string, unknown>)}
      className="ml-auto mr-0 my-0 h-dvh max-h-dvh w-full max-w-md border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-0 text-zinc-900 dark:text-zinc-100 shadow-xl open:flex flex-col"
    >
      {item && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="min-w-0 pr-3">
              <h2
                id="override-drawer-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Human-in-the-Loop Override
              </h2>
              <p className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                #{item.short_asset_id} · {item.channel} · {item.country}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRequestClose}
              aria-label="Close override drawer"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 shrink-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Form body */}
          <form
            onSubmit={handleSubmit}
            className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
          >
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3.5 text-xs space-y-1.5">
              <div className="font-medium text-zinc-700 dark:text-zinc-300">
                Current Classification Snapshot
              </div>
              <div className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                <span>Brand</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100 text-right">
                  {item.brand_name}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                <span>Theme</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100 text-right">
                  {item.theme_label}
                </span>
              </div>
              <div className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                <span>Category</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100 text-right">
                  {item.category}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="override-field-select"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Field to Override
              </label>
              <select
                id="override-field-select"
                autoFocus
                value={fieldName}
                onChange={(e) =>
                  handleFieldChange(e.target.value as EditableField)
                }
                className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              >
                <option value="matched_brand_id">
                  Matched Brand (matched_brand_id)
                </option>
                <option value="theme_label">
                  Creative Theme (theme_label)
                </option>
                <option value="category">Category (category)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="override-human-value"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Verified Human Value
              </label>
              {fieldName === "matched_brand_id" ? (
                <select
                  id="override-human-value"
                  value={humanValue}
                  onChange={(e) => setHumanValue(e.target.value)}
                  className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
                >
                  {BRAND_LIST.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                  <option value="Unverified / Other">Unverified / Other</option>
                </select>
              ) : (
                <>
                  <input
                    id="override-human-value"
                    type="text"
                    list={
                      fieldName === "theme_label"
                        ? "override-theme-options"
                        : "override-category-options"
                    }
                    value={humanValue}
                    onChange={(e) => setHumanValue(e.target.value)}
                    placeholder="Select or enter verified label..."
                    className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
                  />
                  <datalist id="override-theme-options">
                    {AVAILABLE_THEMES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <datalist id="override-category-options">
                    {AVAILABLE_CATEGORIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </>
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                AI value recorded:{" "}
                <span className="font-mono">{currentAiValue}</span>
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="override-reviewer"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Reviewer
              </label>
              <input
                id="override-reviewer"
                type="text"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="e.g. A. Hoffmann"
                className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="override-reason"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Audit Reason
              </label>
              <textarea
                id="override-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why the model label should be corrected..."
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
              >
                {errorMsg}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleRequestClose}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors"
              >
                {submitting ? "Saving Override..." : "Save Override"}
              </button>
            </div>
          </form>
        </>
      )}
    </dialog>
  );
}
