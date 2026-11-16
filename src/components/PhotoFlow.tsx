import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api } from "../api";
import type { Game, Session, UploadTicket } from "../types";

export default function PhotoFlow({
  session,
  roundId,
  remaining,
  displayRemaining,
  uploadExpired,
  now,
  onSendStarted,
  onUpdate,
}: {
  session: Session;
  roundId: string;
  remaining: number;
  displayRemaining: number;
  uploadExpired: boolean;
  now: number;
  onSendStarted: (time: number | null) => void;
  onUpdate: (game: Game) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const ticket = useRef<UploadTicket | null>(null);
  const key = useRef(crypto.randomUUID());
  const attemptStarted = useRef<number | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [ready, setReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const expired = remaining <= 0;
  const deadlinePassed = useRef(expired);
  deadlinePassed.current = expired;
  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  async function startCamera() {
    if (requesting || deadlinePassed.current) return;
    setError("");
    setRequesting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "カメラにはHTTPS接続（またはlocalhost）が必要です。対応ブラウザで開いてください。",
        );
      stop();
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!mounted.current || deadlinePassed.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setReady(true);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "カメラが許可されていません。ブラウザの設定でカメラを許可し、再試行してください。"
            : e instanceof Error
              ? e.message
              : "カメラを起動できませんでした。",
        );
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (!expired) void startCamera();
    return () => {
      mounted.current = false;
      stop();
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (preview) reviewHeading.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (expired) {
      stop();
    }
  }, [expired]);
  useEffect(() => {
    if (uploadExpired) controller.current?.abort();
  }, [uploadExpired]);
  async function capture() {
    if (!video.current?.videoWidth || expired || inFlight.current) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      1280 / Math.max(video.current.videoWidth, video.current.videoHeight),
    );
    canvas.width = Math.round(video.current.videoWidth * scale);
    canvas.height = Math.round(video.current.videoHeight * scale);
    canvas
      .getContext("2d")!
      .drawImage(video.current, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.78),
    );
    if (!blob || blob.size > 2 * 1024 * 1024) {
      setError("写真を圧縮できませんでした。もう一度撮影してください。");
      return;
    }
    if (mounted.current) {
      setPhoto(blob);
      ticket.current = null;
      key.current = crypto.randomUUID();
      setError("");
    }
  }
  async function submit() {
    if (!photo || uploadExpired || (expired && attemptStarted.current === null) || inFlight.current) return;
    inFlight.current = true;
    if (attemptStarted.current === null) {
      attemptStarted.current = now;
      onSendStarted(now);
    }
    stop();
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      setStep("送信を受け付け中…");
      ticket.current ||= await api.uploadTicket(
        session,
        roundId,
        photo,
        key.current,
        controller.current.signal,
      );
      setStep("写真をアップロード中…");
      await api.upload(ticket.current, photo, controller.current.signal);
      setStep("送信を確認中…");
      const game = await api.confirmPhoto(
        session,
        roundId,
        ticket.current,
        key.current,
        controller.current.signal,
      );
      if (mounted.current) onUpdate(game);
    } catch (e) {
      // An HTTP response can be lost after the server accepts the photo.
      const latest = await api.state(session).catch(() => null);
      if (
        latest?.submissions.some(
          (s) => s.roundId === roundId && s.playerId === session.playerId,
        )
      ) {
        if (mounted.current) onUpdate(latest);
      } else if (mounted.current)
        setError(
          e instanceof Error && e.name !== "AbortError"
            ? e.message
            : "受付時間が終了しました。送信状況を確認しています。",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className={`capture-flow ${preview ? "review-mode" : ""}`}>
      <div className={`camera-view ${preview ? "hidden" : ""}`}>
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={preview ? "hidden" : ""}
          aria-label="カメラのライブプレビュー"
        />
        {!ready && !preview && (
          <div className="camera-placeholder">
            <CameraOff size={38} />
            <strong>
              {requesting ? "カメラを起動中…" : "カメラを準備しましょう"}
            </strong>
            {!requesting && !expired && (
              <button className="button light small" onClick={startCamera}>
                カメラを許可する
              </button>
            )}
          </div>
        )}
        {ready && !preview && (
          <>
            <span className="viewfinder top-left" />
            <span className="viewfinder top-right" />
            <span className="viewfinder bottom-left" />
            <span className="viewfinder bottom-right" />
            <span className="camera-caption">
              1 / 2　まず写真を撮影します
            </span>
          </>
        )}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {preview ? (
        <div className="photo-review-screen">
          <section
            className="photo-review-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-review-title"
            aria-describedby="photo-review-status"
          >
            <div className="photo-review-heading">
              <div>
                <span className="photo-review-step">2 / 2　写真を確認</span>
                <h2 id="photo-review-title" ref={reviewHeading} tabIndex={-1}>
                  この写真を送信しますか？
                </h2>
              </div>
              {(!expired || attemptStarted.current !== null) && (
                <span className="photo-review-time">{attemptStarted.current !== null ? "送信時 残り" : "残り"} {displayRemaining} 秒</span>
              )}
            </div>
            <img className="photo-review-thumbnail" src={preview} alt="撮影した写真" />
            <p id="photo-review-status" className="photo-review-status" aria-live="polite">
              {uploadExpired || (expired && attemptStarted.current === null)
                ? "受付時間が終了しました。結果をお待ちください。"
                : busy
                  ? step
                  : attemptStarted.current !== null
                    ? "送信を完了できませんでした。同じ写真を再送信できます。"
                    : "まだ送信されていません。写真を確認してください。"}
            </p>
            {!uploadExpired && (!expired || attemptStarted.current !== null) && (
              <div className="capture-actions">
                <button
                  className="button secondary"
                  disabled={busy || expired}
                  onClick={() => {
                    setPhoto(null);
                    ticket.current = null;
                    attemptStarted.current = null;
                    onSendStarted(null);
                    setError("");
                    void startCamera();
                  }}
                >
                  <RotateCcw size={18} />
                  撮り直す
                </button>
                <button className="button primary" disabled={busy} onClick={submit}>
                  {busy ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : (
                    <Send size={18} />
                  )}
                  {busy ? "送信中…" : attemptStarted.current !== null ? "写真を再送信" : "この写真を送信する"}
                </button>
              </div>
            )}
          </section>
        </div>
      ) : expired ? (
        <div className="notice">
          受付時間が終了しました。結果をお待ちください。
        </div>
      ) : (
        <button
          className="button primary full"
          disabled={!ready || busy}
          onClick={capture}
        >
          <Camera size={20} />
          1 / 2　写真を撮る
        </button>
      )}
      <p className="privacy-note">
        <ShieldCheck size={14} />
        写真はゲームの判定に使用されます。顔や個人情報の写り込みにご注意ください。
      </p>
    </div>
  );
}
