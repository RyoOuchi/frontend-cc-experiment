import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Check,
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
  onUpdate,
}: {
  session: Session;
  roundId: string;
  remaining: number;
  onUpdate: (game: Game) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const ticket = useRef<UploadTicket | null>(null);
  const key = useRef(crypto.randomUUID());
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [ready, setReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const expired = remaining <= 0;
  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  async function startCamera() {
    if (requesting) return;
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
      if (!mounted.current) {
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
    void startCamera();
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
    if (expired) {
      stop();
      controller.current?.abort();
    }
  }, [expired]);
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
    if (!photo || expired || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      setStep("写真をアップロード中…");
      ticket.current ||= await api.uploadTicket(
        session,
        roundId,
        photo,
        key.current,
      );
      await api.upload(ticket.current, photo, controller.current.signal);
      setStep("送信を確認中…");
      const game = await api.confirmPhoto(
        session,
        roundId,
        ticket.current,
        key.current,
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
    <div className="capture-flow">
      <div className={`camera-view ${preview ? "has-photo" : ""}`}>
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={preview ? "hidden" : ""}
          aria-label="カメラのライブプレビュー"
        />
        {preview && <img src={preview} alt="撮影した写真のプレビュー" />}
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
              お題のものを、フレームの中に。
            </span>
          </>
        )}
        {preview && (
          <span className="preview-label">
            <Check size={14} /> プレビュー
          </span>
        )}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {expired ? (
        <div className="notice">
          受付時間が終了しました。結果をお待ちください。
        </div>
      ) : preview ? (
        <div className="capture-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setPhoto(null);
              ticket.current = null;
              setError("");
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
            {busy ? step : "写真を送る"}
          </button>
        </div>
      ) : (
        <button
          className="button primary full"
          disabled={!ready || busy}
          onClick={capture}
        >
          <Camera size={20} />
          写真をとる
        </button>
      )}
      <p className="privacy-note">
        <ShieldCheck size={14} />
        写真はゲームの判定に使用されます。顔や個人情報の写り込みにご注意ください。
      </p>
    </div>
  );
}
