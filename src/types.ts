export type GameStatus =
  | "DRAFT"
  | "LOBBY"
  | "COUNTDOWN"
  | "ACTIVE"
  | "JUDGING"
  | "RESULTS"
  | "FINISHED";
export type Judgment = "PENDING" | "CORRECT" | "INCORRECT" | "ERROR";
export interface Prompt {
  roundId: string;
  promptText: string;
  acceptedLabels: string[];
  minConfidence: number;
}
/** POST /labels/suggest の応答。matched=false は「該当なし」。 */
export interface LabelSuggestion {
  labels: string[];
  matched: boolean;
  reason?: string;
}
export interface Round {
  roundId: string;
  roundNumber: number;
  promptText?: string;
  startAt: number;
  endAt: number;
  uploadDeadlineAt?: number;
}
export interface Player {
  playerId: string;
  displayName: string;
  totalScore: number;
  rank: number;
  color: number;
}
export interface Submission {
  submissionId: string;
  roundId: string;
  playerId: string;
  photoUrl?: string;
  reviewUrl?: string;
  submittedAt: number;
  elapsedMs: number;
  status: Judgment;
  moderationStatus: "PENDING" | "SAFE" | "BLOCKED";
  moderationMethod?: string;
  moderationReason?: string;
  earnedScore: number | null;
  rank: number | null;
  detectedLabels: { name: string; confidence: number }[];
  judgeMethod?: string;
  judgeReason?: string;
  judgeConfidence?: number | null;
  judgedAt?: number;
}
export interface Game {
  gameId: string;
  gameCode: string;
  status: GameStatus;
  currentRound: number;
  totalRounds: number;
  serverTime: number;
  revision: number;
  reviewMode: "manual" | "automatic";
  players: Player[];
  prompts?: Prompt[];
  round: Round | null;
  submissions: Submission[];
}
export interface Session {
  gameId: string;
  token: string;
  role: "ADMIN" | "PLAYER";
  playerId?: string;
}
export interface SessionResponse {
  session: Session;
  game: Game;
}
export interface UploadTicket {
  submissionId: string;
  imageKey: string;
  uploadUrl: string;
  headers?: Record<string, string>;
  startedAt?: number;
  uploadDeadlineAt?: number;
}
