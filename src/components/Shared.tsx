import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  HelpCircle,
  Radio,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";
import type { Game, Player } from "../types";
import Modal from "./Modal";
import { connection } from "../endpoints";

export function Brand() {
  return (
    <a href="/" className="brand" aria-label="Color Hunt ホーム">
      <span className="brand-symbol">
        <Camera size={22} strokeWidth={2.6} />
        <i />
      </span>
      <span>
        Color<span className="brand-hunt">Hunt</span>
        <span className="brand-dot">.</span>
      </span>
    </a>
  );
}
export function Header({
  admin = false,
  game,
}: {
  admin?: boolean;
  game?: Game | null;
}) {
  const [help, setHelp] = useState(false);
  return (
    <>
      <header className="site-header">
        <Brand />
        <div className="header-right">
          {game && (
            <span className="header-members">
              <Users size={17} />
              <b>{game.players.length}</b>
              <span>人が参加中</span>
            </span>
          )}
          <button
            className="text-button help-button"
            aria-label="あそびかた"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={17} />
            <span>あそびかた</span>
          </button>
          {!game && (
            <a className="header-link" href={admin ? "/" : "/admin"}>
              {admin ? "プレイヤーとして参加" : "ゲームをつくる"}
              <span>↗</span>
            </a>
          )}
          {game && (
            <span className="role-badge">{admin ? "HOST" : "PLAYER"}</span>
          )}
        </div>
      </header>
      {help && (
        <Modal title="Color Hunt のあそびかた" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>
              お題のものを見つけて、写真を送ろう。早く正解するほど、高得点！
            </p>
            <ol>
              <li>ゲームコードと表示名を入力して参加。</li>
              <li>3秒のカウントダウン後に、お題が公開されます。</li>
              <li>
                15秒以内に撮影して「写真を送る」。送信は1ラウンド1回です。
              </li>
              <li>判定後にポイントが確定。次のお題はホストが開始します。</li>
            </ol>
            <div className="score-guide">
              {[100, 80, 60, 40, 20].map((p, i) => (
                <div key={p}>
                  <small>
                    {i + 1}
                    {i === 4 ? "位〜" : "位"}
                  </small>
                  <strong>
                    {p}
                    <small> pt</small>
                  </strong>
                </div>
              ))}
            </div>
            <p className="muted small-text">
              正解した人のサーバー受付時刻で順位が決まります。同時刻・同得点は同順位。判定エラーはホストの確認を待ちます。
            </p>
            <button
              className="button primary full"
              onClick={() => setHelp(false)}
            >
              わかった！
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <span>© Color Hunt</span>
      <span>いつもの景色に、新しい発見を。</span>
      <span>
        {connection.mode === "demo" ? (
          <>
            <i className="status-dot amber" />
            ローカルデモ · 手動判定
          </>
        ) : (
          <>
            <i className="status-dot" />
            LIVE GAME
          </>
        )}
      </span>
    </footer>
  );
}
export function Avatar({
  player,
  large = false,
}: {
  player: Pick<Player, "displayName" | "color">;
  large?: boolean;
}) {
  return (
    <span
      className={`avatar color-${player.color % 6} ${large ? "avatar-large" : ""}`}
    >
      {[...player.displayName][0] || "?"}
    </span>
  );
}
export function GameCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="game-code">
      <span className="eyebrow">GAME CODE</span>
      <div>
        <strong>{code}</strong>
        <button
          className="icon-button"
          aria-label="ゲームコードをコピー"
          onClick={copy}
        >
          {copied ? <Check size={19} /> : <Copy size={19} />}
        </button>
      </div>
      {copied && <small role="status">コピーしました</small>}
      {failed && (
        <small role="status">コードを選択してコピーしてください</small>
      )}
    </div>
  );
}
export function Participants({ game }: { game: Game }) {
  return (
    <div className="participants">
      <div className="section-heading">
        <h3>
          <Users size={17} />
          参加プレイヤー
        </h3>
        <span>{game.players.length} / 50</span>
      </div>
      {game.players.length ? (
        <div className="player-chips">
          {game.players.map((player) => (
            <div className="player-chip" key={player.playerId}>
              <Avatar player={player} />
              <span>{player.displayName}</span>
              <CheckCircle2 size={15} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-participants">
          <Users size={30} />
          <p>最初のプレイヤーを待っています</p>
          <small>ゲームコードをみんなにシェアしよう。</small>
        </div>
      )}
    </div>
  );
}
export function Leaderboard({
  game,
  playerId,
  compact = false,
}: {
  game: Game;
  playerId?: string;
  compact?: boolean;
}) {
  const players = [...game.players].sort(
    (a, b) => a.rank - b.rank || a.displayName.localeCompare(b.displayName),
  );
  return (
    <section className={`leaderboard ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <h3>
          <Trophy size={18} />
          {game.status === "FINISHED" ? "最終ランキング" : "総合ランキング"}
        </h3>
        <span>{game.players.length} PLAYERS</span>
      </div>
      <div className="ranking-header">
        <span>順位 / プレイヤー</span>
        <span>合計ポイント</span>
      </div>
      {players.map((player) => (
        <div
          className={`ranking-row ${player.playerId === playerId ? "is-you" : ""}`}
          key={player.playerId}
        >
          <span className={`rank rank-${player.rank}`}>
            {player.rank === 1 ? (
              <Crown size={20} />
            ) : (
              String(player.rank).padStart(2, "0")
            )}
          </span>
          <Avatar player={player} />
          <span className="player-name">
            {player.displayName}
            {player.playerId === playerId && <small>あなた</small>}
          </span>
          <strong>
            {player.totalScore}
            <small> pt</small>
          </strong>
        </div>
      ))}
    </section>
  );
}
export function Podium({ game }: { game: Game }) {
  const winners = game.players.filter((p) => p.rank === 1);
  return (
    <section className="final-celebration">
      <span className="eyebrow">
        <Sparkles size={15} /> THAT'S A GREAT HUNT!
      </span>
      <h1>みんなの発見に、拍手！</h1>
      <p>
        今回の優勝は{" "}
        <strong>{winners.map((p) => p.displayName).join("・") || "—"}</strong>
      </p>
      <div className="podium">
        {[2, 1, 3].map((rank) => {
          const players = game.players.filter((p) => p.rank === rank);
          return (
            <div
              className={`podium-place place-${rank} ${!players.length ? "vacant" : ""}`}
              key={rank}
            >
              {rank === 1 && <Crown className="podium-crown" size={32} />}
              <div className="podium-people">
                {players.length ? (
                  players.map((player) => (
                    <div key={player.playerId}>
                      <Avatar player={player} large />
                      <strong>{player.displayName}</strong>
                    </div>
                  ))
                ) : (
                  <span className="podium-empty">—</span>
                )}
              </div>
              <span className="podium-score">
                {players[0]?.totalScore ?? "—"} <small>pt</small>
              </span>
              <div className="podium-block">
                <span>{rank}</span>
                <small>
                  {rank === 1 ? "GOLD" : rank === 2 ? "SILVER" : "BRONZE"}
                </small>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function Countdown({
  count,
  roundNumber,
  totalRounds,
}: {
  count: number;
  roundNumber: number;
  totalRounds: number;
}) {
  return (
    <section className="countdown-screen">
      <span className="eyebrow light-label">
        ROUND {roundNumber} / {totalRounds}
      </span>
      <p>カメラの準備はいい？</p>
      <h1>Game starts in</h1>
      <div className="countdown-number" key={count}>
        {count > 0 ? count : <Radio size={66} />}
      </div>
      <span>
        {count > 0 ? "お題が出たら、ハント開始！" : "お題を受信しています…"}
      </span>
      <div className="countdown-dots">
        {[3, 2, 1].map((n) => (
          <i className={count <= n ? "lit" : ""} key={n} />
        ))}
      </div>
    </section>
  );
}
