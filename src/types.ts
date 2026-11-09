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
export interface Round {
  roundId: string;
  roundNumber: number;
  promptText?: string;
  startAt: number;
  endAt: number;
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
  earnedScore: number | null;
  rank: number | null;
  detectedLabels: { name: string; confidence: number }[];
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
}
