import type { LabelSuggestion } from "./types";

export function parseLabelSuggestion(value: unknown): LabelSuggestion {
  const data = value as Partial<LabelSuggestion> | null;
  if (!data || !Array.isArray(data.labels) || data.labels.length > 5 ||
      !data.labels.every((label) => typeof label === "string" && label.trim().length > 0) ||
      typeof data.matched !== "boolean" || data.matched !== (data.labels.length > 0) ||
      (data.reason !== undefined && typeof data.reason !== "string")) {
    throw new Error("候補の応答を確認できませんでした。ラベルは手入力できます。");
  }
  return { labels: [...new Set(data.labels)], matched: data.matched, reason: data.reason };
}
