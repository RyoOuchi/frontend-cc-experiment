import { useEffect, useState } from "react";
import { LoaderCircle, WifiOff } from "lucide-react";
import { api, ApiError } from "./api";
import {
  adminToken,
  clearAdminToken,
  completeSignIn,
  signIn,
  storeHostAccessCode,
} from "./auth";
import { connection } from "./endpoints";
import { useGame } from "./hooks/useGame";
import { Footer, Header } from "./components/Shared";
import Join from "./components/Join";
import AdminGame, { AdminWelcome } from "./components/AdminGame";
import PlayerGame from "./components/PlayerGame";
import Modal from "./components/Modal";

export default function App() {
  const admin = location.pathname.replace(/\/$/, "") === "/admin";
  const state = useGame(admin ? "ADMIN" : "PLAYER");
  const isJoinScreen = !admin && !state.session;
  const [busy, setBusy] = useState(false);
  const [hostLoginOpen, setHostLoginOpen] = useState(false);
  const [hostCode, setHostCode] = useState("");
  const [hostCodeError, setHostCodeError] = useState("");
  const [authenticated, setAuthenticated] = useState(
    connection.mode === "demo" || Boolean(adminToken()),
  );
  useEffect(() => {
    document.title = admin
      ? "Color Hunt — ホストワークスペース"
      : "Color Hunt — 見つけて。撮って。いちばんに。";
    if (admin)
      void completeSignIn()
        .then((result) => {
          if (result) setAuthenticated(true);
        })
        .catch((error) => state.setError(error.message));
  }, []);
  async function create() {
    if (busy) return;
    if (connection.mode === "live" && !adminToken()) {
      setAuthenticated(false);
      state.setError(
        "ログインの有効期限が切れました。もう一度ログインしてください。",
      );
      return;
    }
    setBusy(true);
    state.setError("");
    try {
      state.enter(await api.createGame(adminToken()));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearAdminToken();
        setAuthenticated(false);
      }
      state.setError(
        e instanceof Error ? e.message : "ゲームを作成できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`app ${admin && state.game ? "host-app" : ""}`}>
      <a className="skip-link" href="#main-content">
        メインコンテンツへ
      </a>
      {!isJoinScreen && <Header admin={admin} game={state.game} />}
      {state.offline && (
        <div className="connection-warning" role="status">
          <WifiOff size={17} />
          接続を確認しています。復帰するとゲームの状態を更新します。
        </div>
      )}
      <div id="main-content" className="app-content">
        {state.session && !state.game ? (
          <main className="loading-screen">
            <LoaderCircle size={32} className="spin" />
            <h2>ゲームに接続しています…</h2>
            {state.offline && (
              <button className="button secondary" onClick={state.leave}>
                ホームへ戻る
              </button>
            )}
          </main>
        ) : state.session && state.game ? (
          admin ? (
            <AdminGame
              game={state.game}
              session={state.session}
              now={state.now}
              accept={state.accept}
              onLeave={state.leave}
            />
          ) : (
            <PlayerGame
              game={state.game}
              session={state.session}
              now={state.now}
              onUpdate={state.accept}
              onLeave={state.leave}
            />
          )
        ) : admin ? (
          <>
            {state.error && (
              <p className="notice error page-width" role="alert">
                {state.error}
              </p>
            )}
            <AdminWelcome
              busy={busy}
              authenticated={authenticated}
              onCreate={create}
              onLogin={() => {
                if (connection.auth.mode === "token") {
                  setHostCodeError("");
                  setHostLoginOpen(true);
                } else {
                  void signIn().catch((error) => state.setError(error.message));
                }
              }}
            />
          </>
        ) : (
          <Join enter={state.enter} initialError={state.error} />
        )}
      </div>
      {hostLoginOpen && (
        <Modal
          title="ホストアクセスコード"
          onClose={() => setHostLoginOpen(false)}
        >
          <form
            className="host-code-form"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                storeHostAccessCode(hostCode);
                setHostCode("");
                setAuthenticated(true);
                setHostLoginOpen(false);
                void create();
              } catch (error) {
                setHostCodeError(
                  error instanceof Error
                    ? error.message
                    : "コードを確認してください。",
                );
              }
            }}
          >
            <p>管理者から受け取ったコードを入力して、ゲームを作成します。</p>
            <label>
              アクセスコード
              <input
                type="password"
                value={hostCode}
                onChange={(event) => setHostCode(event.target.value)}
                autoComplete="off"
                required
                maxLength={512}
              />
            </label>
            {hostCodeError && (
              <p className="notice error" role="alert">
                {hostCodeError}
              </p>
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={busy}
            >
              ゲームを作成
            </button>
          </form>
        </Modal>
      )}
      {!isJoinScreen && <Footer />}
    </div>
  );
}
