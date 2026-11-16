import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Lightbulb,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { LabelSuggestion, Prompt } from "../types";

/** 行ごとの「候補を取得」の状態。none は該当なし(matched=false)。 */
type Suggest =
  | { state: "loading" }
  | { state: "done" | "none" | "error"; message: string };

type Draft = {
  roundId: string;
  promptText: string;
  labels: string;
  minConfidence: number;
};
const empty = (): Draft => ({
  roundId: crypto.randomUUID(),
  promptText: "",
  labels: "",
  minConfidence: 85,
});
const examples = [
  ["時計", "Clock, Wristwatch"],
  ["ペットボトル", "Water Bottle"],
  ["椅子", "Chair"],
  ["本", "Book"],
];
export default function PromptEditor({
  initial,
  onSave,
  onSuggest,
  busy,
}: {
  initial?: Prompt[];
  onSave: (prompts: Prompt[]) => Promise<void>;
  /** 日本語のお題 → 英語ラベル候補。渡さなければ従来どおり手入力のみ。 */
  onSuggest?: (promptText: string, signal?: AbortSignal) => Promise<LabelSuggestion>;
  busy: boolean;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial?.length
      ? initial.map((p) => ({ ...p, labels: p.acceptedLabels.join(", ") }))
      : Array.from({ length: 4 }, empty),
  );
  const [error, setError] = useState("");
  const [suggests, setSuggests] = useState<Record<string, Suggest>>({});
  // 行ごとの最新リクエスト番号。お題を直したあとに古い応答が届いても反映しない。
  const latest = useRef<Record<string, number>>({});
  const requests = useRef<Record<string, AbortController>>({});
  useEffect(() => () => {
    for (const [id, request] of Object.entries(requests.current)) {
      latest.current[id] = (latest.current[id] ?? 0) + 1;
      request.abort();
    }
  }, []);
  const suggesting = Object.values(suggests).some((s) => s.state === "loading");
  function update(index: number, patch: Partial<Draft>) {
    setDrafts((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
  function forgetSuggest(roundId: string) {
    requests.current[roundId]?.abort();
    delete requests.current[roundId];
    latest.current[roundId] = (latest.current[roundId] ?? 0) + 1;
    setSuggests(({ [roundId]: _gone, ...rest }) => rest);
  }
  async function suggest(roundId: string, promptText: string) {
    if (!onSuggest) return;
    const text = promptText.trim();
    if (!text) {
      setSuggests((s) => ({
        ...s,
        [roundId]: { state: "error", message: "先にお題を入力してください。" },
      }));
      return;
    }
    const ticket = (latest.current[roundId] ?? 0) + 1;
    latest.current[roundId] = ticket;
    const controller = new AbortController();
    requests.current[roundId]?.abort();
    requests.current[roundId] = controller;
    setSuggests((s) => ({ ...s, [roundId]: { state: "loading" } }));
    const result = await Promise.resolve().then(() => onSuggest(text, controller.signal)).then(
      (value) => ({ value }) as const,
      (e: unknown) => ({ e }) as const,
    );
    if (latest.current[roundId] !== ticket) return;
    delete requests.current[roundId];
    if ("e" in result) {
      setSuggests((s) => ({
        ...s,
        [roundId]: {
          state: "error",
          message:
            (result.e instanceof Error ? result.e.message : "") ||
            "候補を取得できませんでした。ラベルは手入力できます。",
        },
      }));
      return;
    }
    const { labels, matched, reason } = result.value;
    if (matched && labels.length) {
      setDrafts((rows) =>
        rows.map((r) =>
          r.roundId === roundId ? { ...r, labels: labels.join(", ") } : r,
        ),
      );
      setSuggests((s) => ({
        ...s,
        [roundId]: {
          state: "done",
          message: reason ? `候補を入力しました(${reason})` : "候補を入力しました",
        },
      }));
    } else {
      setSuggests((s) => ({
        ...s,
        [roundId]: {
          state: "none",
          message: "該当なし" + (reason ? `(${reason})` : ""),
        },
      }));
    }
  }
  function move(index: number, by: number) {
    setDrafts((rows) => {
      const copy = [...rows];
      [copy[index], copy[index + by]] = [copy[index + by], copy[index]];
      return copy;
    });
  }
  async function save() {
    if (busy || suggesting) return;
    const prompts = drafts.map((p) => ({
      roundId: p.roundId,
      promptText: p.promptText.trim(),
      acceptedLabels: p.labels
        .split(/[,、\n]/)
        .map((l) => l.trim())
        .filter(Boolean),
      minConfidence: p.minConfidence,
    }));
    if (
      prompts.some(
        (p) =>
          !p.promptText ||
          !p.acceptedLabels.length ||
          !Number.isFinite(p.minConfidence) ||
          p.minConfidence < 0 ||
          p.minConfidence > 100,
      )
    ) {
      setError(
        "すべてのお題・正解ラベルを入力し、信頼度を0〜100%で設定してください。",
      );
      return;
    }
    setError("");
    await onSave(prompts);
  }
  return (
    <section className="prompt-editor">
      <div className="page-title">
        <div>
          <span className="eyebrow">MAKE YOUR HUNT</span>
          <h1>どんな発見を、あつめよう？</h1>
          <p>身近なものをお題に。上から順に出題されます。</p>
        </div>
        <span className="count-badge">{drafts.length} ラウンド</span>
      </div>
      <div className="editor-tip">
        <Lightbulb size={20} />
        <div>
          <strong>はじめてなら、身のまわりにあるものから。</strong>
          <span>
            時計、本、椅子など、みんなが見つけやすいお題がおすすめです。
          </span>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            drafts.forEach((draft) => forgetSuggest(draft.roundId));
            setDrafts(
              examples.map(([promptText, labels]) => ({
                ...empty(),
                promptText,
                labels,
              })),
            );
          }}
        >
          サンプルを使う <ArrowRight size={15} />
        </button>
      </div>
      <div className="prompt-list">
        {drafts.map((prompt, index) => (
          <article className="prompt-row" key={prompt.roundId}>
            <div className="prompt-number">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="prompt-fields">
              <div className="prompt-main-fields">
                <label>
                  お題 {index + 1}
                  <input
                    value={prompt.promptText}
                    maxLength={60}
                    placeholder={`例：${examples[index % 4][0]}`}
                    onChange={(e) => {
                      update(index, { promptText: e.target.value });
                      forgetSuggest(prompt.roundId);
                    }}
                    disabled={busy}
                  />
                </label>
                <label>
                  正解ラベル <span>カンマ区切り・英語</span>
                  <input
                    value={prompt.labels}
                    maxLength={600}
                    placeholder={examples[index % 4][1]}
                    onChange={(e) => {
                      update(index, { labels: e.target.value });
                      forgetSuggest(prompt.roundId);
                    }}
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="confidence-row">
                <label htmlFor={`confidence-${prompt.roundId}`}>
                  判定の信頼度
                </label>
                <input
                  id={`confidence-${prompt.roundId}`}
                  type="number"
                  min="0"
                  max="100"
                  value={
                    Number.isNaN(prompt.minConfidence)
                      ? ""
                      : prompt.minConfidence
                  }
                  onChange={(e) =>
                    update(index, { minConfidence: e.target.valueAsNumber })
                  }
                  disabled={busy}
                />
                <span>% 以上</span>
                <small>正解ラベルのいずれかと一致した場合に正解</small>
              </div>
              {onSuggest && (
                <div className="suggest-row">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => suggest(prompt.roundId, prompt.promptText)}
                    disabled={
                      busy ||
                      !prompt.promptText.trim() ||
                      suggests[prompt.roundId]?.state === "loading"
                    }
                  >
                    <Sparkles size={14} />
                    {suggests[prompt.roundId]?.state === "loading"
                      ? "候補を探しています…"
                      : "お題から英語ラベルの候補を取得"}
                  </button>
                  {(() => {
                    const s = suggests[prompt.roundId];
                    return s && s.state !== "loading" ? (
                      <span
                        className={`suggest-status ${s.state}`}
                        role={s.state === "error" ? "alert" : "status"}
                      >
                        {s.message}
                      </span>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
            <div className="prompt-row-actions">
              <button
                className="icon-button"
                aria-label={`お題${index + 1}を上へ`}
                onClick={() => move(index, -1)}
                disabled={busy || index === 0}
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`お題${index + 1}を下へ`}
                onClick={() => move(index, 1)}
                disabled={busy || index === drafts.length - 1}
              >
                <ArrowDown size={16} />
              </button>
              <button
                className="icon-button delete-button"
                aria-label={`お題${index + 1}を削除`}
                onClick={() => {
                  forgetSuggest(prompt.roundId);
                  setDrafts((rows) => rows.filter((row) => row.roundId !== prompt.roundId));
                }}
                disabled={busy || drafts.length === 1}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <button
        className="add-prompt"
        onClick={() => setDrafts([...drafts, empty()])}
        disabled={busy || drafts.length >= 30}
      >
        <Plus size={19} />
        お題を追加<span>最大30ラウンド</span>
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-footer">
        <span>
          <strong>{drafts.length}</strong> お題 · 各15秒
        </span>
        <button className="button primary" onClick={save} disabled={busy || suggesting}>
          {busy ? "保存しています…" : "お題を決定して、ロビーへ"}
          <ArrowRight size={18} />
        </button>
      </div>
    </section>
  );
}
