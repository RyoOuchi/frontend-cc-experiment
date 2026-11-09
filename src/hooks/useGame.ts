import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, clearSession, getSession, saveSession } from "../api";
import { connection, realtime } from "../endpoints";
import { connectGameEvents } from "../realtime";
import type { Game, Session, SessionResponse } from "../types";

export function useGame(role: Session["role"]) {
  const [session, setSession] = useState<Session | null>(() =>
    getSession(role),
  );
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const currentGame = useRef<Game | null>(null);
  const accept = useCallback((next: Game, roundTripMs = 0) => {
    const previous = currentGame.current;
    if (previous?.gameId === next.gameId && previous.revision > next.revision)
      return;
    currentGame.current = next;
    offset.current = next.serverTime + roundTripMs / 2 - Date.now();
    setClock(Date.now() + offset.current);
    setGame(next);
  }, []);
  const enter = useCallback(
    (response: SessionResponse) => {
      saveSession(response.session);
      setError("");
      setOffline(false);
      setSession(response.session);
      accept(response.game);
    },
    [accept],
  );
  const leave = useCallback(() => {
    clearSession(role);
    currentGame.current = null;
    setSession(null);
    setGame(null);
    setError("");
  }, [role]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now() + offset.current), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    let pending = false;
    const refresh = async () => {
      if (controller.signal.aborted) return;
      if (fetching) {
        pending = true;
        return;
      }
      fetching = true;
      const started = Date.now();
      try {
        const next = await api.state(session, controller.signal);
        if (!controller.signal.aborted) {
          accept(next, Date.now() - started);
          setOffline(false);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            clearSession(role);
            currentGame.current = null;
            setSession(null);
            setGame(null);
            setError(e.message);
          } else setOffline(true);
        }
      } finally {
        fetching = false;
        if (pending) {
          pending = false;
          void refresh();
        }
      }
    };
    const poll = async () => {
      await refresh();
      if (!controller.signal.aborted)
        timer = setTimeout(poll, connection.pollIntervalMs);
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void poll();
    const disconnect = connectGameEvents({
      ...realtime,
      url: connection.websocketUrl,
      gameId: session.gameId,
      getTicket: (signal) => api.socketTicket(session, signal),
      getRevision: () =>
        currentGame.current?.gameId === session.gameId
          ? currentGame.current.revision
          : 0,
      onChange: () => {
        void refresh();
      },
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
      disconnect();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [session, role, accept]);
  return {
    session,
    game,
    error,
    setError,
    offline,
    now: clock,
    enter,
    leave,
    accept,
  };
}
