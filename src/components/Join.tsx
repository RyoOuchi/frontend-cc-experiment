import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, ScanLine } from "lucide-react";
import { api } from "../api";
import type { SessionResponse } from "../types";

export default function Join({
  enter,
  initialError,
}: {
  enter: (value: SessionResponse) => void;
  initialError: string;
}) {
  const [code, setCode] = useState(
    () =>
      new URLSearchParams(location.search)
        .get("game")
        ?.slice(0, 6)
        .toUpperCase() || "",
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setError("ゲームコードは英数字6文字で入力してください。");
      return;
    }
    if (!name.trim() || [...name.trim()].length > 20) {
      setError("表示名は1〜20文字で入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      enter(await api.joinGame(code, name.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="join-page">
      <section className="join-card" aria-labelledby="join-title">
        <div className="join-card-top">
          <span className="small-symbol">
            <ScanLine size={26} />
          </span>
          <span className="eyebrow">LET'S PLAY</span>
        </div>
        <h1 id="join-title">ゲームに参加</h1>
        <p className="muted">ホストから教えてもらったコードを入力。</p>
        <form onSubmit={join}>
          <label htmlFor="game-code">
            ゲームコード <span>6文字の英数字</span>
          </label>
          <input
            id="game-code"
            className="code-input"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())
            }
            maxLength={6}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-describedby="join-error"
          />
          <label htmlFor="display-name">
            表示名 <span>みんなに見える名前</span>
          </label>
          <input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="あなたのニックネーム"
            autoComplete="nickname"
            required
            aria-describedby="join-error"
          />
          {(error || initialError) && (
            <p className="notice error" id="join-error" role="alert">
              {error || initialError}
            </p>
          )}
          <button className="button primary full join-submit" disabled={busy}>
            {busy ? "参加しています…" : "ゲームに参加"}
            <ArrowRight size={19} />
          </button>
          <p className="signup-note">
            <Check size={14} />
            アカウント登録は不要です
          </p>
        </form>
        <div className="host-invite">
          <span>みんなを招待する？</span>
          <a href="/admin">
            ゲームをつくる <ArrowRight size={15} />
          </a>
        </div>
      </section>
    </main>
  );
}
