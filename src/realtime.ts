type Options = {
  url: string;
  gameId: string;
  ticketParameter: string;
  events: readonly string[];
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  reconnectMaxMs: number;
  getTicket: (signal: AbortSignal) => Promise<{ ticket: string }>;
  getRevision: () => number;
  onChange: () => void;
};

/** A socket announces changes; the authorized HTTP API supplies the game snapshot. */
export function connectGameEvents(options: Options): () => void {
  if (!options.url) return () => {};
  const controller = new AbortController();
  let socket: WebSocket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let pongDeadline: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const clearHeartbeat = () => {
    clearTimeout(heartbeat);
    clearTimeout(pongDeadline);
  };
  const retry = () => {
    if (controller.signal.aborted) return;
    clearTimeout(reconnect);
    reconnect = setTimeout(
      connect,
      Math.min(options.reconnectMaxMs, 1000 * 2 ** attempts++),
    );
  };
  const connect = async () => {
    if (controller.signal.aborted) return;
    try {
      const { ticket } = await options.getTicket(controller.signal);
      if (controller.signal.aborted) return;
      const url = new URL(options.url);
      url.searchParams.set(options.ticketParameter, ticket);
      const ws = new WebSocket(url);
      socket = ws;
      const active = () => !controller.signal.aborted && socket === ws;
      const ping = () => {
        if (!active() || ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify({ action: "ping" }));
          pongDeadline = setTimeout(
            () => ws.close(),
            options.heartbeatTimeoutMs,
          );
        } catch {
          ws.close();
        }
      };
      ws.onopen = () => {
        if (!active()) return;
        attempts = 0;
        options.onChange(); // Recover changes missed while disconnected.
        ping();
      };
      ws.onmessage = (event) => {
        if (!active()) return;
        try {
          const message = JSON.parse(event.data);
          if (!message || typeof message !== "object") return;
          if (message.type === "PONG") {
            clearHeartbeat();
            heartbeat = setTimeout(ping, options.heartbeatIntervalMs);
            return;
          }
          if (
            options.events.includes(message.type || message.event) &&
            message.gameId === options.gameId &&
            Number.isSafeInteger(message.revision) &&
            message.revision > options.getRevision()
          )
            options.onChange();
        } catch {
          // Non-JSON and malformed messages do not affect the game session.
        }
      };
      ws.onerror = () => {
        if (active()) ws.close();
      };
      ws.onclose = () => {
        if (!active()) return;
        clearHeartbeat();
        socket = undefined;
        retry();
      };
    } catch {
      retry();
    }
  };
  void connect();
  return () => {
    controller.abort();
    clearTimeout(reconnect);
    clearHeartbeat();
    socket?.close();
  };
}
