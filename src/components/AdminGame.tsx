import { useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Flag,
  ImageOff,
  LayoutGrid,
  ListChecks,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "../api";
import type { Game, Session, Submission } from "../types";
import {
  Avatar,
  Countdown,
  GameCode,
  Leaderboard,
  Participants,
  Podium,
} from "./Shared";
import PromptEditor from "./PromptEditor";
import Modal from "./Modal";

const statusLabels = {
  PENDING: "判定待ち",
  CORRECT: "正解",
  INCORRECT: "不正解",
  ERROR: "判定エラー",
};
export default function AdminGame({
  game,
  session,
  now,
  accept,
  onLeave,
}: {
  game: Game;
  session: Session;
  now: number;
  accept: (game: Game) => void;
  onLeave: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<Submission | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"CORRECT" | "INCORRECT">("CORRECT");
  const [safe, setSafe] = useState(true);
  const [modalError, setModalError] = useState("");
  const phase =
    game.status === "DRAFT" || editing
      ? 0
      : game.status === "LOBBY"
        ? 1
        : game.status === "FINISHED"
          ? 3
          : 2;
  const round = game.round;
  const seconds = round
    ? Math.max(0, Math.ceil((round.endAt - now) / 1000))
    : 15;
  const pending = game.submissions.filter(
    (s) => s.status === "PENDING" || s.status === "ERROR",
  ).length;
  const submissions = [...game.submissions].sort(
    (a, b) => a.submittedAt - b.submittedAt,
  );
  async function run(action: () => Promise<Game>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      accept(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  function openReview(submission: Submission) {
    setReview(submission);
    setReason("");
    setDecision(submission.status === "INCORRECT" ? "INCORRECT" : "CORRECT");
    setSafe(submission.moderationStatus !== "BLOCKED");
    setModalError("");
  }
  async function judge() {
    if (!review || busy) return;
    if (!reason.trim()) {
      setModalError("判定の理由を入力してください。");
      return;
    }
    setBusy(true);
    setModalError("");
    try {
      accept(
        await api.judge(
          session,
          review.submissionId,
          safe ? decision : "INCORRECT",
          reason,
          safe ? "SAFE" : "BLOCKED",
        ),
      );
      setReview(null);
    } catch (e) {
      setModalError(
        e instanceof Error ? e.message : "判定を保存できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="sidebar-label">HOST WORKSPACE</div>
        <nav aria-label="ゲームの進行">
          {[
            ["お題の設定", ListChecks],
            ["ゲームロビー", Users],
            ["ライブゲーム", LayoutGrid],
            ["最終結果", Trophy],
          ].map(([label, Icon], index) => {
            const ItemIcon = Icon as typeof Users;
            return (
              <div
                className={`sidebar-item ${phase === index ? "active" : ""} ${phase > index ? "complete" : ""}`}
                aria-current={phase === index ? "step" : undefined}
                key={index}
              >
                <ItemIcon size={19} />
                <span>{String(label)}</span>
                {phase > index ? (
                  <Check size={15} />
                ) : phase === index ? (
                  <ChevronRight size={15} />
                ) : (
                  <span className="sidebar-number">0{index + 1}</span>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-rule">
            <Clock3 size={18} />
            <div>
              <strong>15秒の小さな冒険。</strong>
              <p>
                みんなの「見つけた！」を
                <br />
                楽しもう。
              </p>
            </div>
          </div>
          <span className="sidebar-session">SESSION / {game.gameCode}</span>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-breadcrumb">
          ワークスペース <ChevronRight size={13} />
          <strong>
            {["お題の設定", "ゲームロビー", "ライブゲーム", "最終結果"][phase]}
          </strong>
          <span className="live-status">
            <i className="status-dot" />
            {game.status === "ACTIVE" ? "LIVE" : "接続中"}
          </span>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {phase === 0 ? (
          <PromptEditor
            initial={game.prompts}
            busy={busy}
            onSave={async (prompts) => {
              setBusy(true);
              setError("");
              try {
                accept(await api.savePrompts(session, prompts));
                setEditing(false);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "お題を保存できませんでした。",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : phase === 1 ? (
          <>
            <div className="page-title">
              <div>
                <span className="eyebrow">THE MORE, THE MERRIER</span>
                <h1>みんなを、ハントに招待しよう。</h1>
                <p>ゲームコードを共有して、プレイヤーが集まるのを待とう。</p>
              </div>
              <span className="badge">
                <i className="status-dot" />
                参加受付中
              </span>
            </div>
            <div className="lobby-grid">
              <section className="lobby-share">
                <span className="lobby-spark">✦</span>
                <span className="eyebrow light-label">SHARE THE ADVENTURE</span>
                <h2>このコードで、つながろう。</h2>
                <GameCode code={game.gameCode} />
                <p>
                  スマートフォンでこのサイトを開き、
                  <br />
                  コードと表示名を入力してください。
                </p>
                <div className="lobby-settings">
                  <span>
                    <ListChecks size={16} />
                    {game.totalRounds} ラウンド
                  </span>
                  <span>
                    <Clock3 size={16} />
                    各15秒
                  </span>
                </div>
              </section>
              <section className="lobby-ready">
                <div className="ready-count">
                  <Users size={25} />
                  <strong>{game.players.length}</strong>
                  <span>人のプレイヤーが参加中</span>
                </div>
                <p>
                  全員そろったら、ゲームをはじめよう。
                  <br />
                  3秒後に最初のお題が公開されます。
                </p>
                <button
                  className="button primary full"
                  disabled={busy || !game.players.length}
                  onClick={() => run(() => api.start(session))}
                >
                  <Play size={18} fill="currentColor" />
                  {busy ? "開始しています…" : "ゲーム開始"}
                </button>
                {!game.players.length && (
                  <small>プレイヤーが1人以上参加すると開始できます</small>
                )}
                <button
                  className="text-button"
                  onClick={() => setEditing(true)}
                >
                  お題を編集する <ArrowRight size={15} />
                </button>
              </section>
            </div>
            <Participants game={game} />
            <section className="prompt-summary">
              <div className="section-heading">
                <h3>今回のお題</h3>
                <span>ホストにのみ表示</span>
              </div>
              <div>
                {game.prompts?.map((prompt, index) => (
                  <span key={prompt.roundId}>
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    {prompt.promptText}
                  </span>
                ))}
              </div>
            </section>
          </>
        ) : phase === 3 ? (
          <>
            <Podium game={game} />
            <Leaderboard game={game} />
            <div className="center-actions">
              <button className="button primary" onClick={onLeave}>
                <Flag size={18} />
                ゲーム終了・ホームへ
              </button>
            </div>
          </>
        ) : game.status === "COUNTDOWN" && round ? (
          <>
            <div className="round-meta">
              <span>
                ゲームコード <b>{game.gameCode}</b>
              </span>
              <span>
                <Users size={16} />
                {game.players.length} プレイヤー
              </span>
            </div>
            <Countdown
              count={Math.max(0, Math.ceil((round.startAt - now) / 1000))}
              roundNumber={game.currentRound}
              totalRounds={game.totalRounds}
            />
          </>
        ) : (
          <>
            <section className="admin-round-banner">
              <div>
                <span className="eyebrow light-label">
                  ROUND {game.currentRound} / {game.totalRounds}
                </span>
                <h1>{round?.promptText || "お題を受信中…"}</h1>
                <p>
                  {game.status === "ACTIVE"
                    ? "プレイヤーが発見を探しています。"
                    : game.status === "JUDGING"
                      ? "写真の受付終了。すべての判定を確定してください。"
                      : "ラウンド終了！みんなの発見を振り返ろう。"}
                </p>
              </div>
              <div className="admin-timer">
                <Clock3 size={22} />
                <strong>
                  {game.status === "ACTIVE"
                    ? String(seconds).padStart(2, "0")
                    : "00"}
                </strong>
                <span>SECONDS LEFT</span>
              </div>
              <div className="banner-bottom">
                <span>
                  <Users size={16} />
                  {game.players.length} 人
                </span>
                <span>
                  <Camera size={16} />
                  {submissions.length} / {game.players.length} 枚
                </span>
                <span>{game.gameCode}</span>
              </div>
            </section>
            <div className="submission-heading">
              <div>
                <h2>
                  みんなの発見 <span>{submissions.length}</span>
                </h2>
                <p>
                  {game.reviewMode === "manual"
                    ? "写真を開いて、安全性とお題との一致を確認してください。"
                    : "安全性が確認された写真を、受付順に表示します。"}
                </p>
              </div>
              <span className="badge">
                {pending
                  ? `${pending} 枚を判定中`
                  : game.status === "RESULTS"
                    ? "すべて判定済み"
                    : "写真を受付中"}
              </span>
            </div>
            {submissions.length ? (
              <div className="submission-grid">
                {submissions.map((submission) => {
                  const player = game.players.find(
                    (p) => p.playerId === submission.playerId,
                  )!;
                  return (
                    <article
                      className="submission-card"
                      key={submission.submissionId}
                    >
                      <div className="submission-image">
                        {submission.moderationStatus === "SAFE" &&
                        submission.photoUrl ? (
                          <img
                            src={submission.photoUrl}
                            alt={`${player.displayName}の写真`}
                          />
                        ) : (
                          <div className="moderation-placeholder">
                            <ShieldCheck size={30} />
                            <span>
                              {submission.moderationStatus === "BLOCKED"
                                ? "この写真は非公開です"
                                : "安全性を確認中"}
                            </span>
                          </div>
                        )}
                        <span
                          className={`judgment-badge judgment-${submission.status.toLowerCase()}`}
                        >
                          {submission.status === "CORRECT" ? (
                            <CheckCircle2 size={13} />
                          ) : submission.status === "INCORRECT" ? (
                            <XCircle size={13} />
                          ) : (
                            <Clock3 size={13} />
                          )}
                          {statusLabels[submission.status]}
                        </span>
                      </div>
                      <div className="submission-body">
                        <div className="submission-player">
                          <Avatar player={player} />
                          <strong>{player.displayName}</strong>
                          <span>
                            {(submission.elapsedMs / 1000).toFixed(3)}s
                          </span>
                        </div>
                        <div className="submission-score">
                          <span>
                            {submission.rank
                              ? `${submission.rank}位`
                              : "順位未確定"}
                          </span>
                          <strong>
                            {submission.earnedScore === null
                              ? "—"
                              : `+${submission.earnedScore}`}
                            <small> pt</small>
                          </strong>
                        </div>
                        <button
                          className="button secondary small full"
                          onClick={() => openReview(submission)}
                        >
                          {submission.status === "PENDING" ||
                          submission.status === "ERROR"
                            ? "写真を確認・判定"
                            : "判定を修正"}
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-submissions">
                <div>
                  <Camera size={35} />
                </div>
                <h3>
                  {game.status === "RESULTS"
                    ? "このラウンドの提出はありませんでした"
                    : "最初の「見つけた！」を待っています"}
                </h3>
                <p>
                  {game.status === "RESULTS"
                    ? "全員0ポイント。次の発見に期待しよう。"
                    : "プレイヤーが送信すると、ここに写真が届きます。"}
                </p>
              </div>
            )}
            {game.status === "JUDGING" && (
              <p className="notice">
                <LoaderCircle size={16} className="spin" />
                {pending}
                枚の判定を待っています。エラーは手動判定または再判定で解決できます。
              </p>
            )}
            {game.status === "RESULTS" && (
              <div className="round-results-bottom">
                <Leaderboard game={game} />
                <div className="next-round">
                  <span className="small-symbol">
                    <Trophy size={25} />
                  </span>
                  <h3>
                    {game.currentRound === game.totalRounds
                      ? "すべてのハントが終了！"
                      : "次の発見が待っている。"}
                  </h3>
                  <p>
                    {game.currentRound === game.totalRounds
                      ? "最終ランキングを、みんなの画面へ。"
                      : "全員の準備ができたら次のお題へ進もう。"}
                  </p>
                  <button
                    className="button primary full"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        game.currentRound === game.totalRounds
                          ? api.finish(session)
                          : api.next(session),
                      )
                    }
                  >
                    {game.currentRound === game.totalRounds
                      ? "最終結果を表示"
                      : "次のラウンド"}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      {review && (
        <Modal
          title="写真の確認・判定"
          onClose={() => setReview(null)}
          locked={busy}
        >
          <div className="review-dialog">
            <p className="muted small-text">
              {review.moderationStatus === "PENDING"
                ? "ホスト専用の確認画面です。安全性を確認するまで写真は一覧に表示されません。"
                : "変更すると、このラウンドの順位と合計ポイントが再計算されます。"}
            </p>
            {review.reviewUrl || review.photoUrl ? (
              <img
                className="review-photo"
                src={review.reviewUrl || review.photoUrl}
                alt="判定対象の写真（ホスト専用）"
              />
            ) : (
              <div className="moderation-placeholder">
                <ImageOff size={32} />
                <span>非公開の写真</span>
              </div>
            )}
            <div className="review-prompt">
              <span>お題</span>
              <strong>{round?.promptText}</strong>
            </div>
            {review.detectedLabels.length > 0 && (
              <p className="small-text">
                検出ラベル：
                {review.detectedLabels
                  .map((l) => `${l.name} ${l.confidence.toFixed(1)}%`)
                  .join(" / ")}
              </p>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={safe}
                onChange={(e) => setSafe(e.target.checked)}
              />
              写真の安全性を確認し、ゲーム内の表示を許可する
            </label>
            <div className="decision-options">
              <button
                className={`button ${decision === "CORRECT" && safe ? "selected-correct" : "secondary"}`}
                aria-pressed={decision === "CORRECT" && safe}
                onClick={() => setDecision("CORRECT")}
                disabled={!safe || busy}
              >
                <CheckCircle2 size={19} />
                正解
              </button>
              <button
                className={`button ${decision === "INCORRECT" || !safe ? "selected-incorrect" : "secondary"}`}
                aria-pressed={decision === "INCORRECT" || !safe}
                onClick={() => setDecision("INCORRECT")}
                disabled={busy}
              >
                <XCircle size={19} />
                不正解
              </button>
            </div>
            <label>
              判定・変更の理由
              <textarea
                value={reason}
                maxLength={300}
                placeholder="例：お題の本がはっきり写っているため"
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </label>
            {modalError && (
              <p className="notice error" role="alert">
                {modalError}
              </p>
            )}
            <button
              className="button primary full"
              onClick={judge}
              disabled={busy}
            >
              {busy ? "保存しています…" : "判定を保存"}
            </button>
            {game.reviewMode === "automatic" && review.status === "ERROR" && (
              <button
                className="button secondary full"
                disabled={busy}
                onClick={async () => {
                  await run(() =>
                    api.retryJudgment(session, review.submissionId),
                  );
                  setReview(null);
                }}
              >
                <RotateCcw size={16} />
                AI判定を再実行
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function AdminWelcome({
  busy,
  authenticated,
  onCreate,
  onLogin,
}: {
  busy: boolean;
  authenticated: boolean;
  onCreate: () => void;
  onLogin: () => void;
}) {
  return (
    <main className="admin-welcome page-width">
      <span className="pill">
        <Users size={15} />
        HOST A LITTLE ADVENTURE
      </span>
      <h1>
        いつもの場所で、
        <br />
        <span>とびきりの発見を。</span>
      </h1>
      <p>
        お題を決めて、コードをシェア。
        <br />
        みんなの「見つけた！」が集まるゲームをつくろう。
      </p>
      <div className="welcome-illustration" aria-hidden="true">
        <span className="welcome-tile tile-one">
          <Camera size={42} />
        </span>
        <span className="welcome-tile tile-two">
          <Trophy size={48} />
        </span>
        <span className="welcome-tile tile-three">
          <Users size={42} />
        </span>
        <i>✦</i>
      </div>
      <button
        className="button primary"
        onClick={authenticated ? onCreate : onLogin}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle size={19} className="spin" />
        ) : (
          <Plus size={19} />
        )}
        {busy
          ? "準備しています…"
          : authenticated
            ? "ゲーム作成"
            : "管理者としてログイン"}
        <ArrowRight size={18} />
      </button>
      <div className="welcome-meta">
        <span>
          <Check size={15} />
          お題を自由に設定
        </span>
        <span>
          <Check size={15} />
          最大50人で対戦
        </span>
        <span>
          <Check size={15} />
          リアルタイムで進行
        </span>
      </div>
    </main>
  );
}
