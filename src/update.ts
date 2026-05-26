import type {
  UserModel,
  ProcessingStep,
  PredictionResult,
  UpdateMode,
  BatchNote,
  PlanningWorkspace,
  SessionIntent,
  WorkspaceDomain,
  WorkspaceResource,
  ScoredResource,
} from "./types";
import { EMPTY_MODEL } from "./types";
import { fillPrompt } from "./prompts";

// === Claude CLI interface ===

interface ClaudeResponse {
  output: string;
  durationMs: number;
  error?: string;
}

export async function callClaude(
  prompt: string,
  systemPrompt?: string,
  model?: string,
  allowedTools?: string[]
): Promise<ClaudeResponse> {
  const body: Record<string, unknown> = { prompt };
  if (systemPrompt) body.systemPrompt = systemPrompt;
  if (model) body.model = model;
  if (allowedTools?.length) body.allowedTools = allowedTools;

  const res = await fetch("/api/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { output: "", durationMs: 0, error: `HTTP ${res.status}: ${text}` };
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

// === JSON extraction ===

function extractJSON(text: string): string {
  // Try direct parse first
  try {
    JSON.parse(text);
    return text;
  } catch {
    // noop
  }

  // Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  // Find first { ... } block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text;
}

// === Workspace response parsing ===

function ensureArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return [val];
  return [];
}

function sanitizeSessionIntent(raw: Record<string, unknown>): SessionIntent {
  return {
    description: typeof raw.description === "string" ? raw.description : "",
    looking_for: ensureArray(raw.looking_for),
    not_looking_for: ensureArray(raw.not_looking_for),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.3,
    confirmed: !!raw.confirmed,
  };
}

const VALID_DOMAIN_STATUSES = ["not started", "researching", "filtering", "explored"];

function sanitizeDomain(d: Record<string, unknown>): WorkspaceDomain {
  return {
    name: String(d.name || ""),
    status: (VALID_DOMAIN_STATUSES.includes(d.status as string)
      ? d.status
      : "not started") as WorkspaceDomain["status"],
    resources: Array.isArray(d.resources) ? d.resources : [],
    summary: typeof d.summary === "string" ? d.summary : null,
  };
}

function sanitizeWorkspace(raw: Record<string, unknown>): PlanningWorkspace {
  const constraints = (raw.constraints || {}) as Record<string, unknown>;
  const intent = (raw.sessionIntent || {}) as Record<string, unknown>;

  // Handle domains as object (keyed by name) or array
  let domains: WorkspaceDomain[];
  if (Array.isArray(raw.domains)) {
    domains = raw.domains.map((d: Record<string, unknown>) => sanitizeDomain(d));
  } else if (raw.domains && typeof raw.domains === "object") {
    domains = Object.entries(raw.domains as Record<string, Record<string, unknown>>).map(
      ([key, val]) => sanitizeDomain({ name: key, ...val })
    );
  } else {
    domains = [];
  }

  return {
    goal: String(raw.goal || ""),
    constraints: {
      // Accept "hard" or legacy "known"
      hard: ensureArray(constraints.hard || constraints.known),
      soft: ensureArray(constraints.soft),
      needed: ensureArray(constraints.needed),
    },
    sessionIntent: sanitizeSessionIntent(intent),
    domains,
    currentFocus: typeof raw.currentFocus === "string" ? raw.currentFocus : null,
    plan: typeof raw.plan === "string" ? raw.plan : null,
  };
}

/** Apply a partial workspace delta onto an existing workspace, preserving resources/filtered. */
export function applyWorkspaceDelta(
  prev: PlanningWorkspace,
  delta: Record<string, unknown>
): PlanningWorkspace {
  const result: PlanningWorkspace = JSON.parse(JSON.stringify(prev));

  if (typeof delta.goal === "string") result.goal = delta.goal;
  if (delta.currentFocus !== undefined) result.currentFocus = typeof delta.currentFocus === "string" ? delta.currentFocus : null;
  if (delta.plan !== undefined) result.plan = typeof delta.plan === "string" ? delta.plan : null;
  // Preserve dimensions and scoredResources — delta never overwrites these
  // (they are managed by the scoring pipeline, not workspace deltas)

  if (delta.sessionIntent && typeof delta.sessionIntent === "object") {
    const di = delta.sessionIntent as Record<string, unknown>;
    result.sessionIntent = { ...result.sessionIntent, ...sanitizeSessionIntent({ ...result.sessionIntent, ...di }) };
  }

  if (delta.constraints && typeof delta.constraints === "object") {
    const dc = delta.constraints as Record<string, unknown>;
    if (dc.hard !== undefined) result.constraints.hard = ensureArray(dc.hard || dc.known);
    if (dc.soft !== undefined) result.constraints.soft = ensureArray(dc.soft);
    if (dc.needed !== undefined) result.constraints.needed = ensureArray(dc.needed);
  }

  if (delta.domains) {
    // Handle both array and object formats
    let deltaDomains: Record<string, unknown>[];
    if (Array.isArray(delta.domains)) {
      deltaDomains = delta.domains;
    } else if (typeof delta.domains === "object") {
      deltaDomains = Object.entries(delta.domains as Record<string, Record<string, unknown>>).map(
        ([key, val]) => ({ name: key, ...val })
      );
    } else {
      deltaDomains = [];
    }

    for (const dd of deltaDomains) {
      const name = String(dd.name || "");
      const existing = result.domains.find((d) => d.name === name);
      if (existing) {
        if (VALID_DOMAIN_STATUSES.includes(dd.status as string)) existing.status = dd.status as WorkspaceDomain["status"];
        if (dd.summary !== undefined) existing.summary = typeof dd.summary === "string" ? dd.summary : null;
        // Preserve resources and filtered — delta never overwrites these
      } else if (name) {
        result.domains.push(sanitizeDomain(dd));
      }
    }
  }

  return result;
}

export function splitWorkspaceResponse(text: string): {
  chatText: string;
  workspace: PlanningWorkspace | null;
  workspaceDelta: Record<string, unknown> | null;
} {
  // Check for delta first
  const deltaMatch = text.match(/```workspace-delta\s*\n([\s\S]*?)\n```/);
  if (deltaMatch) {
    const chatText = text.slice(0, deltaMatch.index).trim();
    try {
      const delta = JSON.parse(deltaMatch[1]);
      return { chatText, workspace: null, workspaceDelta: delta };
    } catch {
      return { chatText: text, workspace: null, workspaceDelta: null };
    }
  }

  // Fall back to full workspace
  const match = text.match(/```workspace\s*\n([\s\S]*?)\n```/);
  if (!match) return { chatText: text, workspace: null, workspaceDelta: null };

  const chatText = text.slice(0, match.index).trim();
  try {
    const raw = JSON.parse(match[1]);
    const workspace = sanitizeWorkspace(raw);
    return { chatText, workspace, workspaceDelta: null };
  } catch {
    return { chatText: text, workspace: null, workspaceDelta: null };
  }
}

// === Structured chat block parsing ===

export interface ResourceBadge { count: number; domains: number; }
export interface OptionItem { title: string; oneLiner: string; url: string; citations: string; }
export interface OptionBlock { domain: string; items: OptionItem[]; }
export type ChatBlock =
  | { type: "text"; content: string }
  | { type: "resources"; badge: ResourceBadge }
  | { type: "options"; block: OptionBlock };

/**
 * Parse structured :::resources{...}::: and :::options{...}::: blocks from chat text.
 * Returns an array of typed blocks for rich rendering.
 */
export function parseChatBlocks(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  // Match :::resources{count=N domains=N}\n...\n::: and :::options{domain="..."}\n...\n:::
  const blockRegex = /:::(resources|options)\{([^}]*)\}\n([\s\S]*?)\n:::/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(text)) !== null) {
    // Add text before this block
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) blocks.push({ type: "text", content: before });
    }

    const blockType = match[1];
    const attrs = match[2];
    const body = match[3];

    if (blockType === "resources") {
      const countMatch = attrs.match(/count=(\d+)/);
      const domainsMatch = attrs.match(/domains=(\d+)/);
      blocks.push({
        type: "resources",
        badge: {
          count: countMatch ? parseInt(countMatch[1]) : 0,
          domains: domainsMatch ? parseInt(domainsMatch[1]) : 0,
        },
      });
    } else if (blockType === "options") {
      const domainMatch = attrs.match(/domain="([^"]+)"/);
      const items: OptionItem[] = [];
      // Parse numbered items: 1. **Title** — one-liner [citations]\n   url
      const itemRegex = /\d+\.\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+?)(?:\n\s+(https?:\/\/\S+))?/g;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(body)) !== null) {
        const oneLinerRaw = itemMatch[2].trim();
        // Extract citations from one-liner
        const citationMatches = oneLinerRaw.match(/\[(?:MV|MB|MG|MP|TV|TB|TG|TP)\d+\]/g);
        const citations = citationMatches ? citationMatches.join(" ") : "";
        const oneLiner = oneLinerRaw.replace(/\s*\[(?:MV|MB|MG|MP|TV|TB|TG|TP)\d+\]\s*/g, " ").trim();
        items.push({
          title: itemMatch[1].trim(),
          oneLiner,
          url: itemMatch[3] || "",
          citations,
        });
      }
      blocks.push({
        type: "options",
        block: { domain: domainMatch ? domainMatch[1] : "", items },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) blocks.push({ type: "text", content: remaining });
  }

  // If no structured blocks found, return single text block
  if (blocks.length === 0 && text.trim()) {
    blocks.push({ type: "text", content: text });
  }

  return blocks;
}

/** Deduplicate resources across domains by URL and normalized title. Returns unique resources with domain provenance. */
export function deduplicateResources(
  domains: WorkspaceDomain[]
): { title: string; url: string; description: string; cost?: string; domains: string[] }[] {
  const byKey = new Map<string, { title: string; url: string; description: string; cost?: string; domains: string[] }>();
  // Track both URL keys and title keys to catch duplicates with different URLs
  const titleToKey = new Map<string, string>();
  for (const domain of domains) {
    for (const r of domain.resources) {
      const urlKey = r.url?.toLowerCase().replace(/\/+$/, '') || "";
      const titleKey = r.title.toLowerCase().replace(/\s*\(.*?\)\s*$/, "").trim();

      // Check if we've seen this title before (even with a different URL)
      const existingKeyForTitle = titleToKey.get(titleKey);
      const key = (urlKey && byKey.has(urlKey)) ? urlKey
        : existingKeyForTitle && byKey.has(existingKeyForTitle) ? existingKeyForTitle
        : urlKey || titleKey;

      if (byKey.has(key)) {
        const existing = byKey.get(key)!;
        if (!existing.domains.includes(domain.name)) {
          existing.domains.push(domain.name);
        }
      } else {
        byKey.set(key, { title: r.title, url: r.url, description: r.description, cost: r.cost, domains: [domain.name] });
      }
      titleToKey.set(titleKey, key);
    }
  }
  return Array.from(byKey.values());
}

/** Find resources from a deduplicated list that haven't been scored yet. */
export function findUnscoredResources(
  deduped: { title: string; url: string; description: string; cost?: string; domains: string[] }[],
  scored: ScoredResource[]
): typeof deduped {
  const norm = (s: string) => s?.toLowerCase().replace(/\/+$/, "").trim() || "";
  const scoredUrls = new Set(scored.map((s) => norm(s.url)));
  const scoredTitles = new Set(scored.map((s) => norm(s.title)));
  return deduped.filter(
    (r) => !scoredUrls.has(norm(r.url)) && !scoredTitles.has(norm(r.title))
  );
}

// === Model serialization with numbered IDs ===

export interface ModelRefEntry {
  label: string;
  field: string;
  role: "mentee" | "mentor";
  confidence?: number;
  evidence?: string[];
}

/**
 * Serialize a UserModel into numbered text for prompts, plus a lookup map for rendering.
 * prefix: "M" for mentee, "T" for mentor
 */
export function serializeModelWithIds(
  model: UserModel,
  prefix: "M" | "T"
): { text: string; lookup: Record<string, ModelRefEntry> } {
  const lines: string[] = [];
  const lookup: Record<string, ModelRefEntry> = {};
  const roleLabel = prefix === "M" ? "MENTEE" : "MENTOR";
  const role = prefix === "M" ? "mentee" : "mentor" as const;

  for (const [fieldName, value] of Object.entries(model)) {
    if (!Array.isArray(value) || value.length === 0) {
      // Non-array fields (summary, worldModel) — include as prose, no ID
      if (typeof value === "string" && value) {
        lines.push(`${roleLabel} ${fieldName.toUpperCase()}:`);
        lines.push(`  ${value}`);
      }
      continue;
    }

    // People field gets special serialization
    if (
      fieldName === "people" &&
      value.length > 0 &&
      typeof (value[0] as Record<string, unknown>)?.name === "string"
    ) {
      lines.push(`${roleLabel} PEOPLE:`);
      let claimCounter = 1;
      for (const person of value as Record<string, unknown>[]) {
        const pName = person.name as string;
        const rel = person.relationship ? ` (${person.relationship})` : "";
        lines.push(`  ${pName}${rel}:`);
        for (const [subField, isToM] of [["situation", false], ["innerModel", true]] as const) {
          const claims = Array.isArray(person[subField]) ? (person[subField] as Record<string, unknown>[]) : [];
          for (const claim of claims) {
            const id = `${prefix}P${claimCounter}`;
            claimCounter++;
            const text = (claim.claim as string) || "";
            const conf = typeof claim.confidence === "number" ? claim.confidence : undefined;
            const confStr = conf !== undefined ? ` (${conf.toFixed(1)})` : "";
            const tomMarker = isToM ? " [ToM]" : "";
            lines.push(`    [${id}] ${text}${confStr}${tomMarker}`);
            const evidence = Array.isArray(claim.evidence) ? (claim.evidence as string[]) : undefined;
            lookup[id] = { label: `${pName}: ${text}`, field: "people", role, confidence: conf, evidence };
          }
        }
      }
      continue;
    }

    // Array fields get numbered IDs
    const fieldLetter = fieldName.charAt(0).toUpperCase();
    const sectionId = `${prefix}${fieldLetter}`;
    lines.push(`${roleLabel} ${fieldName.toUpperCase()}:`);

    value.forEach((item: unknown, i: number) => {
      if (typeof item !== "object" || item === null) return;
      const obj = item as Record<string, unknown>;
      const name = getEntryName(obj);
      if (!name) return;

      const id = `${sectionId}${i + 1}`;
      const conf = typeof obj.confidence === "number" ? obj.confidence : undefined;
      const confStr = conf !== undefined ? ` (${conf.toFixed(1)})` : "";
      const displayText = `${name}${confStr}`;
      const evidence = Array.isArray(obj.evidence) ? (obj.evidence as string[]) : undefined;

      lines.push(`  [${id}] ${displayText}`);
      lookup[id] = { label: name, field: fieldName, role, confidence: conf, evidence };
    });
  }

  return { text: lines.join("\n"), lookup };
}

// === Generic delta application ===

// Find the "name" field in a list entry — first string field that isn't a known non-name field
export function getEntryName(item: unknown): string | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const obj = item as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && k !== "confidence" && k !== "reasoning") {
      // Skip array-valued fields like "evidence"
      return v;
    }
  }
  return null;
}

function isArrayDelta(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  return "add" in obj || "update" in obj || "remove" in obj;
}

function applyArrayDelta(arr: unknown[], delta: Record<string, unknown>): unknown[] {
  let result = arr.map(item => JSON.parse(JSON.stringify(item)));

  // Remove: match by entry name
  if (Array.isArray(delta.remove)) {
    const removeSet = new Set((delta.remove as string[]).map(s => s.toLowerCase()));
    result = result.filter(item => {
      const name = getEntryName(item);
      return !name || !removeSet.has(name.toLowerCase());
    });
  }

  // Update: match by name, merge confidence/evidence
  if (Array.isArray(delta.update)) {
    for (const upd of delta.update) {
      const updName = getEntryName(upd);
      if (!updName) continue;
      const existing = result.find(item =>
        getEntryName(item)?.toLowerCase() === updName.toLowerCase()
      );
      if (existing && typeof existing === "object" && existing !== null) {
        const obj = existing as Record<string, unknown>;
        const updObj = upd as Record<string, unknown>;
        if (updObj.confidence !== undefined) obj.confidence = updObj.confidence;
        if (Array.isArray(updObj.addEvidence) && Array.isArray(obj.evidence)) {
          (obj.evidence as string[]).push(...(updObj.addEvidence as string[]));
        }
      }
    }
  }

  // Add
  if (Array.isArray(delta.add)) {
    result.push(...delta.add);
  }

  return result;
}

// Detect if a delta value is a people delta ({add/update/remove} where add items have name + situation/innerModel)
function isPeopleDelta(v: unknown): boolean {
  if (!isArrayDelta(v)) return false;
  const obj = v as Record<string, unknown>;
  if (Array.isArray(obj.add) && obj.add.length > 0) {
    return obj.add.some(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string"
    );
  }
  if (Array.isArray(obj.update) && obj.update.length > 0) {
    return obj.update.some(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string"
    );
  }
  return false;
}

function applyPeopleDelta(people: unknown[], delta: Record<string, unknown>): unknown[] {
  let result = people.map((item) => JSON.parse(JSON.stringify(item)));

  // Remove by name
  if (Array.isArray(delta.remove)) {
    const removeSet = new Set(
      (delta.remove as string[]).map((s) => s.toLowerCase())
    );
    result = result.filter((item) => {
      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.toLowerCase() : "";
      return !removeSet.has(name);
    });
  }

  // Update: find by name, merge sub-arrays
  if (Array.isArray(delta.update)) {
    for (const upd of delta.update as Record<string, unknown>[]) {
      const updName = typeof upd.name === "string" ? upd.name : "";
      const existing = result.find(
        (item) =>
          typeof (item as Record<string, unknown>).name === "string" &&
          ((item as Record<string, unknown>).name as string).toLowerCase() ===
            updName.toLowerCase()
      ) as Record<string, unknown> | undefined;

      if (!existing) continue;

      // Update relationship if provided
      if (typeof upd.relationship === "string") {
        existing.relationship = upd.relationship;
      }

      // Merge sub-arrays: addSituation, addInnerModel
      for (const [addKey, targetKey] of [
        ["addSituation", "situation"],
        ["addInnerModel", "innerModel"],
      ] as const) {
        if (Array.isArray(upd[addKey])) {
          if (!Array.isArray(existing[targetKey])) existing[targetKey] = [];
          (existing[targetKey] as unknown[]).push(...(upd[addKey] as unknown[]));
        }
      }

      // Update existing claims within sub-arrays: updateSituation, updateInnerModel
      for (const [updateKey, targetKey] of [
        ["updateSituation", "situation"],
        ["updateInnerModel", "innerModel"],
      ] as const) {
        if (Array.isArray(upd[updateKey]) && Array.isArray(existing[targetKey])) {
          for (const claimUpd of upd[updateKey] as Record<string, unknown>[]) {
            const claimText = typeof claimUpd.claim === "string" ? claimUpd.claim : "";
            const match = (existing[targetKey] as Record<string, unknown>[]).find(
              (c) =>
                typeof c.claim === "string" &&
                c.claim.toLowerCase() === claimText.toLowerCase()
            );
            if (match) {
              if (claimUpd.confidence !== undefined) match.confidence = claimUpd.confidence;
              if (Array.isArray(claimUpd.addEvidence) && Array.isArray(match.evidence)) {
                (match.evidence as string[]).push(...(claimUpd.addEvidence as string[]));
              }
            }
          }
        }
      }
    }
  }

  // Add new people
  if (Array.isArray(delta.add)) {
    result.push(...delta.add);
  }

  return result;
}

export function applyDelta(model: UserModel, delta: Record<string, unknown>): UserModel {
  const next: UserModel = JSON.parse(JSON.stringify(model));

  for (const [key, value] of Object.entries(delta)) {
    if (key === "reasoning") continue; // meta field, not model data

    if (value === null) {
      delete next[key]; // null = remove field
    } else if (isPeopleDelta(value)) {
      // People delta: nested sub-array merging by person name
      next[key] = applyPeopleDelta(
        Array.isArray(next[key]) ? (next[key] as unknown[]) : [],
        value as Record<string, unknown>
      );
    } else if (isArrayDelta(value)) {
      // Has add/update/remove sub-fields → apply to existing array
      next[key] = applyArrayDelta(
        Array.isArray(next[key]) ? (next[key] as unknown[]) : [],
        value as Record<string, unknown>
      );
    } else if (Array.isArray(value)) {
      // Full replacement array
      next[key] = value;
    } else {
      // Scalar (string, object) → overwrite
      next[key] = value;
    }
  }
  return next;
}

// === Prediction ===

async function generatePrediction(
  noteText: string,
  currentModel: UserModel,
  prompts: Record<string, string>,
  model?: string
): Promise<{ question: string; predicted: string; promptUsed: string }> {
  // Step 1: Generate question from note
  const qPrompt = fillPrompt(prompts.generateQuestion, { note: noteText });
  const qRes = await callClaude(qPrompt, undefined, model);
  const question = qRes.output.trim();

  // Step 2: Predict answer from current model
  const pPrompt = fillPrompt(prompts.predictAnswer, {
    model: JSON.stringify(currentModel, null, 2),
    question,
  });
  const pRes = await callClaude(pPrompt, undefined, model);
  const predicted = pRes.output.trim();

  return { question, predicted, promptUsed: pPrompt };
}

async function scorePrediction(
  question: string,
  predicted: string,
  noteText: string,
  prompts: Record<string, string>,
  model?: string
): Promise<{ score: number; reasoning: string }> {
  const prompt = fillPrompt(prompts.scoreAccuracy, {
    question,
    predicted,
    actual: noteText,
  });
  const res = await callClaude(prompt, undefined, model);

  try {
    const json = JSON.parse(extractJSON(res.output));
    return {
      score: typeof json.score === "number" ? json.score : 0,
      reasoning: json.reasoning || "",
    };
  } catch {
    return { score: 0, reasoning: `Parse error: ${res.output.slice(0, 200)}` };
  }
}

// === Model update ===

export async function updateModel(
  currentModel: UserModel,
  noteText: string,
  target: "mentee" | "mentor",
  mode: UpdateMode,
  prompts: Record<string, string>,
  model?: string
): Promise<{
  prompt: string;
  rawResponse: string;
  delta?: Record<string, unknown>;
  newModel: UserModel;
}> {
  const templateKey = mode === "delta" ? "deltaUpdate" : "fullUpdate";
  const prompt = fillPrompt(prompts[templateKey], {
    model: JSON.stringify(currentModel, null, 2),
    note: noteText,
    target,
  });

  const res = await callClaude(prompt, undefined, model);
  const rawResponse = res.output;

  try {
    const parsed = JSON.parse(extractJSON(rawResponse));

    if (mode === "delta") {
      const delta = parsed as Record<string, unknown>;
      const newModel = applyDelta(currentModel, delta);
      return { prompt, rawResponse, delta, newModel };
    } else {
      // Full mode: parsed IS the new model (no hardcoded field extraction)
      const newModel: UserModel = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "reasoning") continue;
        newModel[key] = value;
      }
      return { prompt, rawResponse, newModel };
    }
  } catch {
    // Parse failed — return model unchanged
    return {
      prompt,
      rawResponse: `PARSE ERROR\n\nRaw output:\n${rawResponse}`,
      newModel: currentModel,
    };
  }
}

// === Process a single note ===

export interface ProcessNoteOptions {
  noteText: string;
  noteIndex: number;
  noteLabel?: string;
  menteeModel: UserModel;
  mentorModel: UserModel;
  mode: UpdateMode;
  prompts: Record<string, string>;
  skipPrediction: boolean;
  updateModel?: string;
  scoringModel?: string;
}

export async function processNote(
  opts: ProcessNoteOptions
): Promise<ProcessingStep> {
  const start = Date.now();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // 1. Prediction (if not first note and model has content)
  let prediction: PredictionResult | undefined;
  const hasContent = Object.keys(opts.menteeModel).length > 0;
  if (!opts.skipPrediction && hasContent) {
    const { question, predicted } = await generatePrediction(
      opts.noteText,
      opts.menteeModel,
      opts.prompts,
      opts.scoringModel
    );
    const { score, reasoning } = await scorePrediction(
      question,
      predicted,
      opts.noteText,
      opts.prompts,
      opts.scoringModel
    );
    prediction = { question, predicted, actual: opts.noteText, score, reasoning };
  }

  // 2+3. Update mentee and mentor models in parallel (independent — same note, different models)
  const [menteeResult, mentorResult] = await Promise.all([
    updateModel(opts.menteeModel, opts.noteText, "mentee", opts.mode, opts.prompts, opts.updateModel),
    updateModel(opts.mentorModel, opts.noteText, "mentor", opts.mode, opts.prompts, opts.updateModel),
  ]);

  return {
    id,
    noteIndex: opts.noteIndex,
    noteText: opts.noteText,
    noteLabel: opts.noteLabel,
    timestamp: Date.now(),
    prediction,
    menteeModelBefore: opts.menteeModel,
    menteePrompt: menteeResult.prompt,
    menteeRawResponse: menteeResult.rawResponse,
    menteeDelta: menteeResult.delta,
    menteeModelAfter: menteeResult.newModel,
    mentorModelBefore: opts.mentorModel,
    mentorPrompt: mentorResult.prompt,
    mentorRawResponse: mentorResult.rawResponse,
    mentorDelta: mentorResult.delta,
    mentorModelAfter: mentorResult.newModel,
    durationMs: Date.now() - start,
    updateModelUsed: opts.updateModel,
    scoringModelUsed: opts.scoringModel,
  };
}

// === Batch processing ===

export async function processBatch(
  notes: BatchNote[],
  mode: UpdateMode,
  prompts: Record<string, string>,
  onStep: (step: ProcessingStep, index: number) => void,
  updateModel?: string,
  scoringModel?: string,
  skipAllPredictions?: boolean
): Promise<ProcessingStep[]> {
  const steps: ProcessingStep[] = [];
  let menteeModel: UserModel = JSON.parse(JSON.stringify(EMPTY_MODEL));
  let mentorModel: UserModel = JSON.parse(JSON.stringify(EMPTY_MODEL));

  for (let i = 0; i < notes.length; i++) {
    const step = await processNote({
      noteText: notes[i].text,
      noteIndex: i,
      noteLabel: notes[i].label,
      menteeModel,
      mentorModel,
      mode,
      prompts,
      skipPrediction: skipAllPredictions || i === 0,
      updateModel,
      scoringModel,
    });

    menteeModel = step.menteeModelAfter;
    mentorModel = step.mentorModelAfter;
    steps.push(step);
    onStep(step, i);
  }

  return steps;
}
