// === User Model (dynamic schema — shape defined by prompts, not TypeScript) ===

// A user model is a bag of fields. The system dispatches on shape:
// - Array of objects with confidence → list field (values, beliefs, goals, etc.)
// - String → prose field (summary, etc.)
// - Object with description + confidence → prose-with-confidence
export type UserModel = Record<string, unknown>;

export const EMPTY_MODEL: UserModel = {};

// === Processing Step (one per note) ===

export interface PredictionResult {
  question: string;
  predicted: string;
  actual: string;
  score: number; // 0-1
  reasoning: string;
}

export interface ProcessingStep {
  id: string;
  noteIndex: number;
  noteText: string;
  noteLabel?: string;
  timestamp: number;

  // Prediction (absent for step 0)
  prediction?: PredictionResult;

  // Mentee update
  menteeModelBefore: UserModel;
  menteePrompt: string;
  menteeRawResponse: string;
  menteeDelta?: Record<string, unknown>;
  menteeModelAfter: UserModel;

  // Mentor update
  mentorModelBefore: UserModel;
  mentorPrompt: string;
  mentorRawResponse: string;
  mentorDelta?: Record<string, unknown>;
  mentorModelAfter: UserModel;

  durationMs: number;

  // Which models were used
  updateModelUsed?: string;
  scoringModelUsed?: string;
}

// === Batch ===

export interface BatchNote {
  text: string;
  label?: string;
}

// === Chat (for planning tab) ===

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** The filled system prompt sent to Claude for this response */
  systemPrompt?: string;
  /** Raw Claude output before workspace parsing */
  rawOutput?: string;
  /** Lookup map for model reference citations — keyed by ID (e.g., "MV1"), value is structured entry */
  refLookup?: Record<string, unknown>;
}

// === Planning Workspace ===

export interface WorkspaceResource {
  title: string;
  url: string;
  description: string;
  cost?: string;
}

export interface FilteredResource {
  title: string;
  url: string;
  description?: string;
  cost?: string;
  score: number;
  fits: string;      // model citation string e.g. "[MV1] [MG2]"
  tensions: string;  // model citation string e.g. "[MP6]"
  oneLiner: string;
}

// A scoring dimension derived from the person's model
export interface ScoringDimension {
  id: string;          // e.g. "pittsburgh_based"
  label: string;       // e.g. "Pittsburgh-based"
  definition: string;  // e.g. "Role is located in Pittsburgh or remote-friendly"
  source: string;      // model citation e.g. "[MP1] [MP6]"
  required: boolean;   // true = gate/dealbreaker (score < 0.3 disqualifies), false = preference
}

// Per-dimension score for a single resource
export interface DimensionScore {
  score: number;       // 0.0-1.0
  signal: string;      // e.g. "HQ in Pittsburgh" — human-readable reason
}

// Deduplicated resource scored on multiple dimensions
export interface ScoredResource {
  title: string;
  url: string;
  description: string;
  cost?: string;
  domains: string[];                          // which research domains found this
  scores: Record<string, DimensionScore>;     // keyed by dimension.id
  oneLiner: string;                           // overall 1-line summary for this person
}

export interface WorkspaceDomain {
  name: string;
  status: "not started" | "researching" | "filtering" | "explored";
  resources: WorkspaceResource[];
  filtered?: FilteredResource[];
  summary: string | null;
}

export interface SessionIntent {
  description: string;
  looking_for: string[];
  not_looking_for: string[];
  confidence: number; // 0-1
  confirmed: boolean;
}

export interface PlanningWorkspace {
  goal: string;
  constraints: { hard: string[]; soft: string[]; needed: string[] };
  sessionIntent: SessionIntent;
  domains: WorkspaceDomain[];
  currentFocus: string | null;
  plan: string | null;
  dimensions?: ScoringDimension[];        // generated once from model
  scoredResources?: ScoredResource[];     // deduplicated + scored across all domains
}

// === Planning Run (replay variant at a timestep) ===

export interface PlanningRun {
  runIndex: number;
  label: string;
  prompts: Record<string, string>;
  messages: ChatMessage[];
  menteeModel: UserModel;
  mentorModel: UserModel;
  workspace: PlanningWorkspace | null;
  createdAt: number;
}

// === App State ===

export type UpdateMode = "delta" | "full";
export type ModelTarget = "mentee" | "mentor";
export type ModelView = "fields" | "prose";
