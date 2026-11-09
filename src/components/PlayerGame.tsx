import { useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LogOut,
  Radio,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import type { Game, Session } from "../types";
import {
  Avatar,
  Countdown,
  GameCode,
  Participants,
  Podium,
} from "./Shared";
import PhotoFlow from "./PhotoFlow";

export default function PlayerGame({
  game,
  session,
  now,
  onUpdate,
  onLeave,
}: {
  game: Game;
  session: Session;
  now: number;
  onUpdate: (game: Game) => void;
  onLeave: () => void;
}) {
  const player = game.players.find((p) => p.playerId === session.playerId);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const round = game.round;
  const submission = game.submissions.find(
    (s) => s.playerId === session.playerId && s.roundId === round?.roundId,
  );
  const seconds = round
    ? Math.max(0, Math.ceil((round.endAt - now) / 1000))
    : 15;
  async function prepareCamera() {
    setCameraError("");
    setPreparing(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("カメラにはHTTPS接続（またはlocalhost）が必要です。");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stream.getTracks().forEach((track) => track.stop());
      setCameraReady(true);
    } catch (e) {
      setCameraError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "ブラウザの設定でカメラを許可してください。"
          : e instanceof Error
            ? e.message
            : "カメラを確認できませんでした。",
      );
    } finally {
      setPreparing(false);
    }
  }
  if (game.status === "FINISHED")
    return (
      <main className="results-page page-width">
        <Podium game={game} />
        <button className="button secondary" onClick={onLeave}>
          <LogOut size={17} />
          ホームへ戻る
        </button>
      </main>
    );
  return (
    <main className="player-page page-width">
      <div className="player-topbar">
        <div className="player-identity">
          {player && <Avatar player={player} />}
          <span>
            {player?.displayName}
            <small>ゲーム {game.gameCode}</small>
          </span>
        </div>
        <div className="points-chip">
          <Trophy size={17} />
          <b>{player?.totalScore || 0}</b>
          <span>pt</span>
        </div>
      </div>
      {["DRAFT", "LOBBY"].includes(game.status) ? (
        <section className="player-lobby">
          <div className="waiting-orbit">
            <Camera size={42} />
            <span className="mini-spark">✦</span>
            <i />
            <i />
          </div>
          <span className="eyebrow">YOU'RE IN!</span>
          <h1>
            みんなが集まるまで、
            <br />
            ちょっとひと息。
          </h1>
          <p>
            Waiting for game to start
            <span className="animated-ellipsis">…</span>
          </p>
          <div className="waiting-status">
            <i className="status-dot" />
            ホストがゲームを開始するのを待っています
          </div>
          <GameCode code={game.gameCode} />
          <div className="camera-prepare">
            <Camera size={23} />
            <div>
              <strong>
                {cameraReady
                  ? "カメラの準備ができました"
                  : "今のうちに、カメラの準備を。"}
              </strong>
              <p>お題が出たら、すぐに撮影できます。</p>
            </div>
            <button
              className={`button ${cameraReady ? "secondary" : "primary"} small`}
              disabled={preparing}
              onClick={prepareCamera}
            >
              {cameraReady ? (
                <CheckCircle2 size={17} />
              ) : preparing ? (
                "確認中…"
              ) : (
                "カメラを確認"
              )}
            </button>
          </div>
          {cameraError && (
            <p className="notice error" role="alert">
              {cameraError}
            </p>
          )}
          <Participants game={game} />
          <p className="privacy-note">
            写真は判定とホストの確認に使用されます。
            <br />
            顔や個人情報を写さないようにしてください。
          </p>
          <button className="text-button muted" onClick={onLeave}>
            ホームへ戻る
          </button>
        </section>
      ) : game.status === "COUNTDOWN" && round ? (
        <Countdown
          count={Math.max(0, Math.ceil((round.startAt - now) / 1000))}
          roundNumber={game.currentRound}
          totalRounds={game.totalRounds}
        />
      ) : (
        <div className="player-round-layout">
          <section className="player-round">
            <div className="round-heading">
              <span className="eyebrow">
                ROUND {game.currentRound} <span>/ {game.totalRounds}</span>
              </span>
              <span className={`timer ${seconds <= 5 ? "urgent" : ""}`}>
                <Clock3 size={18} />
                <b>
                  {game.status === "ACTIVE"
                    ? String(seconds).padStart(2, "0")
                    : "00"}
                </b>
                <small>秒</small>
              </span>
            </div>
            <div className="prompt-display">
              <span>これを見つけよう！</span>
              <h1>{round?.promptText || "お題を受信中…"}</h1>
            </div>
            <div className="time-track">
              <span
                style={{
                  width: `${game.status === "ACTIVE" ? (seconds / 15) * 100 : 0}%`,
                }}
              />
            </div>
            {game.status === "ACTIVE" && !submission && round ? (
              <PhotoFlow
                key={round.roundId}
                session={session}
                roundId={round.roundId}
                remaining={seconds}
                onUpdate={onUpdate}
              />
            ) : (
              <div className="player-result">
                {submission?.photoUrl && (
                  <img
                    className="submitted-photo"
                    src={submission.photoUrl}
                    alt="送信した写真"
                  />
                )}
                {!submission ? (
                  <>
                    <div className="result-icon neutral">
                      <Clock3 size={31} />
                    </div>
                    <h2>時間切れ</h2>
                    <p>このラウンドでは写真を送信できませんでした。</p>
                  </>
                ) : submission.status === "PENDING" ? (
                  <>
                    <div className="result-icon pending">
                      <LoaderCircle size={32} className="spin" />
                    </div>
                    <h2>写真を送信しました</h2>
                    <p>
                      {game.reviewMode === "manual"
                        ? "ホストが写真を確認しています…"
                        : "AIが判定中です…"}
                    </p>
                  </>
                ) : submission.status === "ERROR" ? (
                  <>
                    <div className="result-icon pending">
                      <Radio size={32} />
                    </div>
                    <h2>判定を確認しています</h2>
                    <p>
                      判定エラーが発生しました。
                      <br />
                      ホストの確認をお待ちください。
                    </p>
                    <span className="badge amber">
                      ポイントはまだ確定していません
                    </span>
                  </>
                ) : (
                  <>
                    <div
                      className={`result-icon ${submission.status === "CORRECT" ? "correct" : "incorrect"}`}
                    >
                      {submission.status === "CORRECT" ? (
                        <CheckCircle2 size={35} />
                      ) : (
                        <XCircle size={35} />
                      )}
                    </div>
                    <h2>
                      {submission.status === "CORRECT"
                        ? "ナイス発見！正解です。"
                        : "お題と一致しませんでした"}
                    </h2>
                    <p>
                      {submission.status === "CORRECT"
                        ? "身近なところに、見つかったね。"
                        : "次のラウンドで、またチャレンジ！"}
                    </p>
                  </>
                )}
                {submission && (
                  <div className="submission-time">
                    <Clock3 size={14} />
                    サーバー受付：{(submission.elapsedMs / 1000).toFixed(3)} 秒
                  </div>
                )}
                {game.status === "RESULTS" ? (
                  <div className="result-stats">
                    <div>
                      <span>今回の順位</span>
                      <strong>
                        {submission?.rank ? `${submission.rank}位` : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>獲得ポイント</span>
                      <strong className="blue-text">
                        +{submission?.earnedScore ?? 0}
                        <small> pt</small>
                      </strong>
                    </div>
                    <div>
                      <span>合計ポイント</span>
                      <strong>
                        {player?.totalScore || 0}
                        <small> pt</small>
                      </strong>
                    </div>
                  </div>
                ) : (
                  <p className="muted small-text">
                    全員の判定が終わると、順位とポイントが確定します。
                  </p>
                )}
                <div className="waiting-status">
                  <i className="status-dot" />
                  {game.status === "RESULTS"
                    ? game.currentRound === game.totalRounds
                      ? "ホストが最終結果を表示するのを待っています"
                      : "次のラウンドを待っています"
                    : "ほかのプレイヤーの結果を待っています"}
                </div>
              </div>
            )}
          </section>
          {game.status === "ACTIVE" && !submission && (
            <p className="round-hint">
              <Sparkles size={15} />
              正しく、速く。1番の正解は100ポイント！
            </p>
          )}
        </div>
      )}
    </main>
  );
}
