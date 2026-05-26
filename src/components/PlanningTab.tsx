import { useState, useCallback, useRef, useEffect } from "react";
import { marked } from "marked";
import type {
  ProcessingStep,
  UserModel,
  ChatMessage,
  ModelView,
  UpdateMode,
  PlanningWorkspace,
  PlanningRun,
  WorkspaceResource,
  ScoringDimension,
  ScoredResource,
} from "../types";
import { EMPTY_MODEL } from "../types";
import { callClaude, updateModel, splitWorkspaceResponse, applyWorkspaceDelta, deduplicateResources, findUnscoredResources, serializeModelWithIds, parseChatBlocks, type ModelRefEntry, type ChatBlock, type OptionBlock, type ResourceBadge } from "../update";
import { fillPrompt, DEFAULT_PROMPTS } from "../prompts";
import { ModelViewComponent } from "./ModelView";
import { WorkspacePanel } from "./WorkspacePanel";
import type { ModelSettings } from "./SessionBar";
import { PALETTE, FONT_HEADING, FONT_BODY, SECTION_COLOR_PALETTE } from "../theme";
import { generateArtifactPage } from "../generateArtifactPage";

// Configure marked for inline rendering
marked.setOptions({ breaks: true });

type AutoUpdateMode = "auto" | "manual" | "off";

// === RankedResults ===

type PillState = "normal" | "prioritized" | "off";

function computeWeightedScore(
  resource: ScoredResource,
  activeDimensions: Set<string>,
  prioritizedDimensions: Set<string>,
  dimensions: ScoringDimension[]
): { score: number; failedRequired: string[] } {
  const activeIds = Array.from(activeDimensions);
  if (activeIds.length === 0) return { score: 0, failedRequired: [] };

  const requiredIds = dimensions.filter(d => d.required && activeDimensions.has(d.id)).map(d => d.id);
  const failedRequired = requiredIds.filter(id => (resource.scores[id]?.score || 0) < 0.3);

  let weightedSum = 0;
  let totalWeight = 0;
  for (const id of activeIds) {
    const weight = prioritizedDimensions.has(id) ? 2 : 1;
    weightedSum += (resource.scores[id]?.score || 0) * weight;
    totalWeight += weight;
  }
  const avg = totalWeight > 0 ? weightedSum / totalWeight : 0;

  if (failedRequired.length > 0) {
    return { score: Math.min(avg * 0.3, 0.25), failedRequired };
  }
  return { score: avg, failedRequired: [] };
}

/** Strip model IDs like [MV1] and editorial fit judgments from signal text */
function stripModelIds(text: string): string {
  return text
    .replace(/\s*\[(?:MV|MB|MG|MP|TV|TB|TG|TP)\d+\]\s*/g, " ")
    .replace(/^(Excellent|Near-ideal|Top|Strong|Good|Great|Perfect|Solid|Exceptional)\s+(fit|match)\s*[—–-]\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildFitsBullets(resource: ScoredResource, dimensions: ScoringDimension[], activeDimensions: Set<string>): string[] {
  const highScoring = dimensions
    .filter(d => activeDimensions.has(d.id) && (resource.scores[d.id]?.score || 0) >= 0.7)
    .sort((a, b) => (resource.scores[b.id]?.score || 0) - (resource.scores[a.id]?.score || 0))
    .slice(0, 3)
    .map(d => stripModelIds(resource.scores[d.id]?.signal || d.label));
  return highScoring.length > 0 ? highScoring : [stripModelIds(resource.oneLiner)];
}

function buildNoteLine(resource: ScoredResource, dimensions: ScoringDimension[], activeDimensions: Set<string>): string | null {
  const tensions = dimensions
    .filter(d => {
      if (!activeDimensions.has(d.id)) return false;
      const score = resource.scores[d.id]?.score || 0;
      return score >= 0.2 && score < 0.5;
    })
    .slice(0, 2)  // Max 2 tensions
    .map(d => stripModelIds(resource.scores[d.id]?.signal || d.label));
  return tensions.length > 0 ? tensions.join(". ") : null;
}

interface ComparisonTableProps {
  dimensions: ScoringDimension[];
  resources: ScoredResource[];
  matchThreshold?: number;
  menteeModel?: UserModel;
  workspace?: PlanningWorkspace;
}

function ComparisonTable({ dimensions, resources, menteeModel, workspace }: ComparisonTableProps) {
  const [pillStates, setPillStates] = useState<Record<string, PillState>>(
    () => Object.fromEntries(dimensions.map((d) => [d.id, "normal" as PillState]))
  );
  const [showMore, setShowMore] = useState(false);
  const [showDealbreakers, setShowDealbreakers] = useState(false);

  const cyclePill = (id: string) => {
    setPillStates((prev) => {
      const current = prev[id] || "normal";
      const next = current === "normal" ? "prioritized" : current === "prioritized" ? "off" : "normal";
      return { ...prev, [id]: next };
    });
  };

  const activeDimensions = new Set(
    Object.entries(pillStates).filter(([, s]) => s !== "off").map(([id]) => id)
  );
  const prioritizedDimensions = new Set(
    Object.entries(pillStates).filter(([, s]) => s === "prioritized").map(([id]) => id)
  );

  const scored = resources.map((r) => {
    const { score, failedRequired } = computeWeightedScore(r, activeDimensions, prioritizedDimensions, dimensions);
    return { resource: r, score, failedRequired };
  });
  scored.sort((a, b) => b.score - a.score);

  const topPicks = scored.filter((s) => s.failedRequired.length === 0).slice(0, 5);
  const morePicks = scored.filter((s) => s.failedRequired.length === 0).slice(5);
  const dealbreakers = scored.filter((s) => s.failedRequired.length > 0);

  const totalDomains = new Set(resources.flatMap((r) => r.domains)).size;

  const pillStyle = (state: PillState, isRequired: boolean): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: "5px 14px", borderRadius: 20, fontSize: 12,
      cursor: "pointer", fontFamily: FONT_BODY, transition: "all 0.2s ease",
      letterSpacing: 0.2, display: "inline-flex", alignItems: "center", gap: 4,
    };
    if (state === "prioritized") return {
      ...base, border: `2px solid ${PALETTE.teal}`, background: PALETTE.teal,
      color: PALETTE.white, fontWeight: 700,
    };
    if (state === "off") return {
      ...base, border: `1.5px dashed ${PALETTE.sand}`, background: "transparent",
      color: PALETTE.inkMuted, fontWeight: 400, textDecoration: "line-through", opacity: 0.5,
    };
    return {
      ...base,
      border: `1.5px solid ${isRequired ? PALETTE.teal : PALETTE.sand}`,
      background: isRequired ? PALETTE.tealBg : "transparent",
      color: isRequired ? PALETTE.teal : PALETTE.inkMuted,
      fontWeight: isRequired ? 600 : 400,
    };
  };

  const openFullPage = () => {
    if (!menteeModel || !workspace) return;
    const html = generateArtifactPage({ dimensions, scoredResources: resources, menteeModel, workspace });
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      {/* Three-state dimension pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, padding: "8px 12px 0", alignItems: "center" }}>
        {dimensions.map((d) => {
          const state = pillStates[d.id] || "normal";
          return (
            <button
              key={d.id}
              onClick={() => cyclePill(d.id)}
              title={`${d.definition}${d.required ? " (required)" : ""} — click to cycle: normal → prioritized → off`}
              style={pillStyle(state, d.required)}
            >
              {d.label}
            </button>
          );
        })}
        {menteeModel && workspace && (
          <button
            onClick={openFullPage}
            style={{
              marginLeft: "auto",
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: FONT_BODY,
              border: `1px solid ${PALETTE.teal}`,
              background: PALETTE.tealBg,
              color: PALETTE.teal,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            View full page ↗
          </button>
        )}
      </div>

      {/* Ranked rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {topPicks.map(({ resource, score }, idx) => {
          const fitsBullets = buildFitsBullets(resource, dimensions, activeDimensions);
          const note = buildNoteLine(resource, dimensions, activeDimensions);
          return (
            <div key={resource.url} style={{
              padding: "14px 16px", borderBottom: `1px solid ${PALETTE.sand}`,
              background: PALETTE.white,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: PALETTE.inkMuted, fontVariantNumeric: "tabular-nums" }}>
                    {idx + 1}.
                  </span>
                  <a href={resource.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 14, fontWeight: 600, color: PALETTE.ink, textDecoration: "none", fontFamily: FONT_HEADING }}>
                    {resource.title}
                  </a>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {resource.domains.map((domain) => (
                    <span key={domain} style={{
                      fontSize: 9, padding: "2px 7px", borderRadius: 10,
                      background: PALETTE.parchment, color: PALETTE.inkMuted,
                      fontWeight: 500, letterSpacing: 0.3,
                    }}>
                      {domain}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12, color: PALETTE.inkLight, marginBottom: 6, marginLeft: 24 }}>
                {stripModelIds(resource.oneLiner)}
              </div>
              <div style={{ marginLeft: 24 }}>
                {fitsBullets.map((bullet, bi) => (
                  <div key={bi} style={{ fontSize: 12, color: PALETTE.teal, lineHeight: 1.5, display: "flex", gap: 6 }}>
                    <span style={{ color: PALETTE.teal, flexShrink: 0 }}>+</span>
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
              {note && (
                <div style={{ fontSize: 12, color: PALETTE.amber, marginLeft: 24, marginTop: 2, lineHeight: 1.5, display: "flex", gap: 6 }}>
                  <span style={{ flexShrink: 0 }}>!</span>
                  <span>{note}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* More options (collapsed) */}
      {morePicks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowMore(!showMore)}
            style={{
              fontSize: 12, color: PALETTE.inkMuted, background: "none",
              border: "none", padding: "8px 0", cursor: "pointer", fontFamily: FONT_BODY,
            }}
          >
            {showMore ? "Hide" : "Show"} {morePicks.length} more options {showMore ? "\u2191" : "\u2193"}
          </button>
          {showMore && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, opacity: 0.7 }}>
              {morePicks.map(({ resource }, idx) => {
                const fits = buildFitsBullets(resource, dimensions, activeDimensions).join(", ");
                return (
                  <div key={resource.url} style={{
                    padding: "10px 16px", borderBottom: `1px solid ${PALETTE.sand}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: PALETTE.inkMuted }}>
                        {topPicks.length + idx + 1}.
                      </span>
                      <a href={resource.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 13, fontWeight: 500, color: PALETTE.ink, textDecoration: "none" }}>
                        {resource.title}
                      </a>
                      <span style={{ fontSize: 11, color: PALETTE.inkMuted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        — {fits}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Didn't meet requirements (collapsed by default) */}
      {dealbreakers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowDealbreakers(!showDealbreakers)}
            style={{
              fontSize: 11, color: PALETTE.inkMuted, background: "none",
              border: "none", padding: "6px 0", cursor: "pointer", fontFamily: FONT_BODY,
              fontStyle: "italic",
            }}
          >
            {showDealbreakers ? "Hide" : "Show"} {dealbreakers.length} that didn't meet requirements {showDealbreakers ? "\u2191" : "\u2193"}
          </button>
          {showDealbreakers && (
            <div style={{ padding: "8px 16px", background: PALETTE.parchment, borderRadius: 8, marginTop: 4 }}>
              {dealbreakers.map(({ resource, failedRequired }) => {
                const failedDims = failedRequired.map(id => {
                  const dim = dimensions.find(d => d.id === id);
                  const signal = stripModelIds(resource.scores[id]?.signal || "");
                  return signal ? `${signal} (${dim?.label || id})` : dim?.label || id;
                });
                return (
                  <div key={resource.url} style={{ padding: "4px 0", fontSize: 12, color: PALETTE.inkMuted }}>
                    <span style={{ fontWeight: 500 }}>{resource.title}</span>
                    <span style={{ color: PALETTE.amber }}> — doesn't meet: {failedDims.join(", ")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  steps: ProcessingStep[];
  prompts: Record<string, string>;
  modelView: ModelView;
  modelSettings: ModelSettings;
  mode: UpdateMode;
  sessionName: string;
  sessionVersion: number;
  focusMode?: boolean;
}

function buildConversationPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

const MD_STYLES = `
.planning-md h1 { font-size: 15px; margin: 8px 0 4px; font-family: ${FONT_HEADING}; }
.planning-md h2 { font-size: 14px; margin: 8px 0 4px; font-family: ${FONT_HEADING}; }
.planning-md h3 { font-size: 13px; margin: 6px 0 2px; font-family: ${FONT_HEADING}; }
.planning-md p { margin: 4px 0; }
.planning-md ul, .planning-md ol { margin: 4px 0; padding-left: 20px; }
.planning-md li { margin: 2px 0; }
.planning-md strong { font-weight: 700; }
.planning-md hr { border: none; border-top: 1px solid ${PALETTE.sand}; margin: 8px 0; }
.planning-md a { color: ${PALETTE.teal}; text-decoration: none; }
.planning-md a:hover { text-decoration: underline; }

/* Model reference citations */
.model-ref-wrap {
  position: relative;
  display: inline;
}
.model-ref-pill {
  cursor: help;
  font-weight: 500;
  font-family: inherit;
  white-space: nowrap;
}
.ref-tooltip {
  display: none;
  position: fixed;
  background: ${PALETTE.parchment};
  color: ${PALETTE.ink};
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid ${PALETTE.sand};
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  max-width: 360px;
  min-width: 200px;
  z-index: 10000;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(26,26,46,0.1);
  font-family: 'Source Sans 3', sans-serif;
  letter-spacing: 0;
  white-space: normal;
}
/* Tooltip inner elements */
.ref-tip-header {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: ${PALETTE.inkMuted};
  margin-bottom: 4px;
}
.ref-tip-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Libre Baskerville', serif;
  color: ${PALETTE.ink};
  margin-bottom: 6px;
}
.ref-tip-quote {
  display: block;
  font-size: 12px;
  font-style: italic;
  color: ${PALETTE.inkLight};
  margin-bottom: 4px;
  line-height: 1.4;
}
.ref-tip-more {
  display: block;
  font-size: 11px;
  color: ${PALETTE.inkMuted};
  margin-top: 2px;
}
`;

// Extract JSON array from a response that may contain markdown/text
function extractJSONArray(text: string): WorkspaceResource[] {
  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* noop */ }

  // Try fenced code block
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* noop */ }
  }

  // Try finding [ ... ] block
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* noop */ }
  }

  return [];
}

function renderModelRefPill(num: number, entry: ModelRefEntry): string {
  const color = entry.field === "people" ? "#e8715a" : "#3b7dd8";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let tooltipHtml = `<span class='ref-tip-label'>${esc(entry.label)}</span>`;

  if (entry.evidence?.length) {
    for (const q of entry.evidence.slice(0, 3)) {
      tooltipHtml += `<span class='ref-tip-quote'>&ldquo;${esc(q)}&rdquo;</span>`;
    }
    if (entry.evidence.length > 3) {
      tooltipHtml += `<span class='ref-tip-more'>+${entry.evidence.length - 3} more</span>`;
    }
  }

  return `<span class="model-ref-wrap"><span class="model-ref-pill" style="color:${color}">(${num})</span><span class="ref-tooltip">${tooltipHtml}</span></span>`;
}

function renderWithModelRefs(html: string, refLookup?: Record<string, ModelRefEntry>): string {
  if (!refLookup || Object.keys(refLookup).length === 0) return html;

  // Pre-scan: assign sequential numbers to IDs in order of first appearance
  const idToNum = new Map<string, number>();
  let counter = 1;
  const allIdPattern = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = allIdPattern.exec(html)) !== null) {
    const ids = (m[1] as string).match(/[MT][A-Z]\d+/g) || [];
    for (const id of ids) {
      if (!idToNum.has(id)) idToNum.set(id, counter++);
    }
  }

  const renderRef = (id: string): string => {
    const entry = refLookup[id];
    const num = idToNum.get(id);
    return entry && num !== undefined ? renderModelRefPill(num, entry) : `[${id}]`;
  };

  // First pass: handle comma-separated IDs in brackets like [MG3, MV3]
  html = html.replace(/\[([MT][A-Z]\d+(?:\s*,\s*[MT][A-Z]\d+)+)\]/g, (match, inner) => {
    const ids = (inner as string).split(/\s*,\s*/);
    return ids.map(renderRef).join(" ");
  });

  // Second pass: handle single IDs and any phrases like [MV1 tension with MV3]
  html = html.replace(/\[([^\]]*?([MT][A-Z]\d+)[^\]]*?)\]/g, (match, inner) => {
    if (/^[MT][A-Z]\d+$/.test(inner)) return renderRef(inner);
    return (inner as string).replace(/([MT][A-Z]\d+)/g, (_, id) => renderRef(id));
  });

  return html;
}

/** Score resources in parallel chunks of 3. Returns all ScoredResource results with domain provenance merged. */
async function scoreBatchesInParallel(
  resources: { title: string; url: string; description: string; cost?: string; domains: string[] }[],
  dimensions: ScoringDimension[],
  menteeText: string,
  prompts: Record<string, string>,
  modelSettings: ModelSettings,
  concurrency = 3
): Promise<ScoredResource[]> {
  const batchSize = 15;
  const batches: (typeof resources)[] = [];
  for (let i = 0; i < resources.length; i += batchSize) {
    batches.push(resources.slice(i, i + batchSize));
  }

  const allScored: ScoredResource[] = [];
  const batchErrors: string[] = [];

  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (batch) => {
        const scorePrompt = fillPrompt(
          prompts.planningFilter || DEFAULT_PROMPTS.planningFilter || "",
          {
            menteeModel: menteeText || "(empty)",
            dimensions: JSON.stringify(dimensions),
            resources: JSON.stringify(batch),
          }
        );
        const res = await callClaude(scorePrompt, undefined, modelSettings.updateModel);
        if (res.error) {
          batchErrors.push(res.error);
          return [] as ScoredResource[];
        }
        const scored = extractJSONArray(res.output) as unknown as ScoredResource[];
        for (const s of scored) {
          const orig = batch.find((r) => r.url === s.url || r.title === s.title);
          if (orig) s.domains = orig.domains;
        }
        return scored;
      })
    );
    allScored.push(...results.flat());
  }

  if (batchErrors.length > 0) {
    console.warn(`Scoring: ${batchErrors.length} batch(es) failed`);
  }

  return allScored;
}

/** Programmatic status bar showing research funnel — rendered above chat input */
function ResearchStatusBar({ workspace, researching, matchThreshold, onThresholdChange, onScoreAll, scoring, badgeView, onBadgeViewChange, expanded, onExpandedChange, menteeModel }: {
  workspace: PlanningWorkspace | null;
  researching: Set<string>;
  matchThreshold: number;
  onThresholdChange: (v: number) => void;
  onScoreAll?: () => void;
  scoring?: boolean;
  badgeView: "table" | "list";
  onBadgeViewChange: (v: "table" | "list") => void;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  menteeModel?: UserModel;
}) {
  if (!workspace) return null;

  const domains = workspace.domains || [];
  const exploredDomains = domains.filter((d) => d.status === "explored" || d.status === "filtering");
  const totalDomains = domains.length;
  const researchingCount = researching.size + domains.filter((d) => d.status === "researching").length;
  const totalResources = exploredDomains.reduce((sum, d) => sum + (d.resources?.length || 0), 0);
  const totalFiltered = exploredDomains.reduce((sum, d) => sum + (d.filtered?.length || 0), 0);
  const matchCount = exploredDomains.reduce(
    (sum, d) => sum + (d.filtered?.filter((r) => r.score >= matchThreshold)?.length || 0), 0
  );

  // Nothing to show yet
  if (totalDomains === 0) return null;
  // All domains are "not started" — no research has begun
  if (exploredDomains.length === 0 && researchingCount === 0) return null;

  const isSearching = researchingCount > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <button
        onClick={() => onExpandedChange(!expanded)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "6px 14px", borderRadius: 0,
          background: isSearching ? PALETTE.amberGlow : PALETTE.tealBg,
          border: `1px solid ${(isSearching || scoring) ? PALETTE.amber : PALETTE.teal}`,
          color: (isSearching || scoring) ? PALETTE.amber : PALETTE.teal,
          fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT_BODY,
        }}
      >
        {isSearching ? (
          <span>Searching {totalDomains} domains... ({exploredDomains.length}/{totalDomains} complete)</span>
        ) : scoring ? (
          <span>Scoring {totalResources} resources across {exploredDomains.length} domains...</span>
        ) : totalFiltered > 0 ? (
          <span>
            {totalResources} resources searched — <strong>{matchCount} strong fits for Jordan</strong>
          </span>
        ) : (
          <span>{workspace.scoredResources?.length ?? totalResources} resources found across {exploredDomains.length} domains</span>
        )}
        <span style={{ fontSize: 10, opacity: 0.7 }}>{expanded ? "−" : "+"}</span>
      </button>
      {expanded && exploredDomains.length > 0 && (() => {
        const hasComparison = workspace.dimensions && workspace.dimensions.length > 0 &&
          workspace.scoredResources && workspace.scoredResources.length > 0;
        return (
          <div style={{
            background: PALETTE.parchment, borderRadius: 0,
            borderTop: `1px solid ${PALETTE.sand}`,
            overflow: "hidden", flex: 1, display: "flex", flexDirection: "column",
          }}>
            {/* Generate button — only when no comparison exists yet */}
            {!hasComparison && onScoreAll && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "6px 12px",
                borderBottom: `1px solid ${PALETTE.sand}`, background: PALETTE.white,
              }}>
                <button onClick={onScoreAll} disabled={scoring} style={{
                  fontSize: 10, padding: "3px 10px", borderRadius: 10,
                  border: `1px solid ${PALETTE.teal}`, background: PALETTE.tealBg,
                  color: PALETTE.teal, fontWeight: 600,
                  cursor: scoring ? "not-allowed" : "pointer", opacity: scoring ? 0.5 : 1,
                  fontFamily: FONT_BODY,
                }}>
                  {scoring ? "Generating..." : "Generate Comparison"}
                </button>
              </div>
            )}

            {/* Table view */}
            {badgeView === "table" && hasComparison && (
              <div style={{ padding: 0, flex: 1, overflowY: "auto" }}>
                <ComparisonTable
                  dimensions={workspace.dimensions!}
                  resources={workspace.scoredResources!}
                  menteeModel={menteeModel}
                  workspace={workspace}
                />
              </div>
            )}

            {/* List view (domain-grouped) */}
            {(badgeView === "list" || !hasComparison) && (
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {domains.map((d, di) => {
                  const isActive = researching.has(d.name) || d.status === "researching";
                  const matchesInDomain = d.filtered?.filter((r) => r.score >= matchThreshold)?.length || 0;
                  const domainColor = SECTION_COLOR_PALETTE[di % SECTION_COLOR_PALETTE.length];
                  return (
                    <div key={d.name} style={{ borderLeft: `3px solid ${domainColor}` }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                        padding: "6px 12px", borderBottom: `1px solid ${PALETTE.sand}`,
                        position: "sticky", top: 0, zIndex: 1,
                        background: PALETTE.parchment, boxShadow: `0 2px 4px ${PALETTE.sand}`,
                      }}>
                        <span style={{ flex: 1, color: domainColor, fontWeight: 700 }}>{d.name}</span>
                        {isActive ? (
                          <span style={{ color: PALETTE.amber, fontSize: 11 }}>searching...</span>
                        ) : d.resources?.length > 0 ? (
                          <span style={{ color: PALETTE.inkMuted, fontVariantNumeric: "tabular-nums", fontSize: 11 }}>
                            {d.resources.length} found
                            {d.filtered && d.filtered.length > 0 && (
                              <span style={{ color: PALETTE.teal, fontWeight: 600, marginLeft: 6 }}>{matchesInDomain} fit</span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: PALETTE.inkMuted, fontSize: 11 }}>not started</span>
                        )}
                      </div>
                      {d.resources?.length > 0 && (
                        <div style={{ padding: "4px 12px 4px 20px" }}>
                          {d.resources.map((r, ri) => (
                            <div key={ri} style={{
                              fontSize: 11, lineHeight: 1.4, padding: "3px 0",
                              borderBottom: ri < d.resources.length - 1 ? `1px solid ${PALETTE.sand}30` : undefined,
                              color: PALETTE.inkLight,
                            }}>
                              <a href={r.url} target="_blank" rel="noopener noreferrer"
                                style={{ color: domainColor, textDecoration: "none", fontWeight: 500, opacity: 0.85 }}>
                                {r.title}
                              </a>
                              {r.cost && <span style={{ color: PALETTE.inkMuted, marginLeft: 4, fontSize: 10 }}>({r.cost})</span>}
                              {r.description && (
                                <div style={{ color: PALETTE.inkMuted, fontSize: 10, marginTop: 1 }}>{r.description}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function AssistantMessageBubble({ msg }: { msg: ChatMessage }) {
  const [showMeta, setShowMeta] = useState<"none" | "prompt" | "raw">("none");
  const contentRef = useRef<HTMLDivElement>(null);
  const hasPrompt = !!msg.systemPrompt;
  const hasRaw = !!msg.rawOutput && msg.rawOutput !== msg.content;

  const rawHtml = marked.parse(msg.content) as string;
  const html = renderWithModelRefs(rawHtml, msg.refLookup as Record<string, ModelRefEntry> | undefined);

  // Attach mouseenter/mouseleave to position fixed tooltips
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const wraps = el.querySelectorAll(".model-ref-wrap");
    const handlers: Array<{ wrap: Element; show: () => void; hide: () => void }> = [];
    wraps.forEach((wrap) => {
      const pill = wrap.querySelector(".model-ref-pill");
      const tip = wrap.querySelector(".ref-tooltip") as HTMLElement | null;
      if (!pill || !tip) return;
      const show = () => {
        const rect = pill.getBoundingClientRect();
        tip.style.display = "block";
        tip.style.left = `${rect.left + rect.width / 2}px`;
        tip.style.top = `${rect.top - 8}px`;
        tip.style.transform = "translate(-50%, -100%)";
      };
      const hide = () => { tip.style.display = "none"; };
      wrap.addEventListener("mouseenter", show);
      wrap.addEventListener("mouseleave", hide);
      handlers.push({ wrap, show, hide });
    });
    return () => {
      handlers.forEach(({ wrap, show, hide }) => {
        wrap.removeEventListener("mouseenter", show);
        wrap.removeEventListener("mouseleave", hide);
      });
    };
  }, [html]);

  return (
    <div style={{ maxWidth: "85%", display: "flex", flexDirection: "column", gap: 0 }}>
      <div
        ref={contentRef}
        className="planning-md"
        style={{
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.6,
          fontFamily: FONT_BODY,
          background: PALETTE.white,
          color: PALETTE.ink,
          borderLeft: `3px solid ${PALETTE.teal}`,
          borderBottomLeftRadius: showMeta !== "none" ? 0 : 4,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(hasPrompt || hasRaw) && (
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "3px 8px",
            background: showMeta !== "none" ? PALETTE.parchment : "transparent",
            borderLeft: `3px solid ${showMeta !== "none" ? PALETTE.teal : "transparent"}`,
            borderBottomLeftRadius: 4,
          }}
        >
          {hasPrompt && (
            <button
              onClick={() => setShowMeta(showMeta === "prompt" ? "none" : "prompt")}
              style={{
                fontSize: 10,
                padding: "1px 5px",
                border: `1px solid ${showMeta === "prompt" ? PALETTE.teal : PALETTE.sand}`,
                borderRadius: 4,
                background: showMeta === "prompt" ? PALETTE.tealBg : "transparent",
                color: showMeta === "prompt" ? PALETTE.teal : PALETTE.inkMuted,
                cursor: "pointer",
              }}
            >
              Prompt
            </button>
          )}
          {hasRaw && (
            <button
              onClick={() => setShowMeta(showMeta === "raw" ? "none" : "raw")}
              style={{
                fontSize: 10,
                padding: "1px 5px",
                border: `1px solid ${showMeta === "raw" ? PALETTE.teal : PALETTE.sand}`,
                borderRadius: 4,
                background: showMeta === "raw" ? PALETTE.tealBg : "transparent",
                color: showMeta === "raw" ? PALETTE.teal : PALETTE.inkMuted,
                cursor: "pointer",
              }}
            >
              Raw Output
            </button>
          )}
        </div>
      )}
      {showMeta === "prompt" && msg.systemPrompt && (
        <pre
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: PALETTE.ink,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            padding: "8px 12px",
            fontFamily: "monospace",
            background: PALETTE.parchment,
            borderLeft: `3px solid ${PALETTE.teal}`,
            borderBottomLeftRadius: 4,
            maxHeight: 400,
            overflow: "auto",
          }}
        >
          {msg.systemPrompt}
        </pre>
      )}
      {showMeta === "raw" && msg.rawOutput && (
        <pre
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: PALETTE.ink,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            padding: "8px 12px",
            fontFamily: "monospace",
            background: PALETTE.parchment,
            borderLeft: `3px solid ${PALETTE.teal}`,
            borderBottomLeftRadius: 4,
            maxHeight: 400,
            overflow: "auto",
          }}
        >
          {msg.rawOutput}
        </pre>
      )}
    </div>
  );
}

export function PlanningTab({
  steps,
  prompts,
  modelView,
  sessionName,
  sessionVersion,
  modelSettings,
  mode,
  focusMode = false,
}: Props) {
  const [timestep, setTimestep] = useState<number | null>(null);
  const [loadedSessionName, setLoadedSessionName] = useState(sessionName);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [menteeModel, setMenteeModel] = useState<UserModel>(
    JSON.parse(JSON.stringify(EMPTY_MODEL))
  );
  const [mentorModel, setMentorModel] = useState<UserModel>(
    JSON.parse(JSON.stringify(EMPTY_MODEL))
  );
  const [autoUpdate, setAutoUpdate] = useState<AutoUpdateMode>("auto");
  const [lastUpdateAt, setLastUpdateAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [prevMenteeModel, setPrevMenteeModel] = useState<UserModel | null>(null);
  const [prevMentorModel, setPrevMentorModel] = useState<UserModel | null>(null);
  const [workspace, setWorkspace] = useState<PlanningWorkspace | null>(null);
  const [useWorkspace, setUseWorkspace] = useState(true);
  const [badgeView, setBadgeView] = useState<"table" | "list">("table");
  const [matchThreshold, setMatchThreshold] = useState(0.7);
  const [researching, setResearching] = useState<Set<string>>(new Set());
  const [scoring, setScoring] = useState(false);
  const researchStartTimes = useRef<Map<string, number>>(new Map());
  const isLoaded = useRef(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [badgeExpanded, setBadgeExpanded] = useState(false);

  // Run/replay state
  const [runs, setRuns] = useState<PlanningRun[]>([]);
  const [activeRunIndex, setActiveRunIndex] = useState<number | null>(null); // null = live conversation
  const [replayState, setReplayState] = useState<{
    running: boolean;
    currentStep: number;
    totalSteps: number;
  } | null>(null);
  const replayCancelledRef = useRef(false);

  // Reset internal state when a session is intentionally loaded or duplicated.
  // Keyed on sessionVersion (not sessionName) so typing in the name field doesn't
  // wipe the planning conversation.
  const prevSessionVersionRef = useRef(sessionVersion);
  useEffect(() => {
    if (prevSessionVersionRef.current === sessionVersion) return;
    prevSessionVersionRef.current = sessionVersion;
    setError(null);
    setStatus(null);
    // Auto-select the last timestep so the plan transfers on duplicate/load.
    // selectTimestep handles all state resets + fetches planning data from server.
    if (steps.length > 0) {
      selectTimestep(steps.length);
    } else {
      setTimestep(null);
      setMessages([]);
      setMenteeModel(JSON.parse(JSON.stringify(EMPTY_MODEL)));
      setMentorModel(JSON.parse(JSON.stringify(EMPTY_MODEL)));
      setPrevMenteeModel(null);
      setPrevMentorModel(null);
      setWorkspace(null);
      setRuns([]);
      setActiveRunIndex(null);
      setReplayState(null);
      setLastUpdateAt(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVersion]);

  // localStorage key for persisting chat — uses loadedSessionName (stable at load time)
  // so edits to the session name field don't cause mid-edit saves to phantom keys
  const storageKey = timestep !== null
    ? `planning-chat-${loadedSessionName || "unsaved"}-t${timestep}`
    : null;

  // Auto-save to server on message/model/workspace change (debounced)
  // Guarded by isLoaded to prevent overwriting server data during async load
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePlanningState = useCallback(() => {
    if (!storageKey || !isLoaded.current || messages.length === 0) return;
    fetch(`/api/planning/${encodeURIComponent(storageKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, menteeModel, mentorModel, workspace, matchThreshold }),
    }).catch((e) => console.warn("Planning save failed:", e));
  }, [storageKey, messages, menteeModel, mentorModel, workspace, matchThreshold]);

  useEffect(() => {
    if (!storageKey || !isLoaded.current || messages.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(savePlanningState, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [storageKey, messages, menteeModel, mentorModel, workspace, matchThreshold, savePlanningState]);

  // Flush pending save when page goes hidden (tab close, refresh, navigate away)
  useEffect(() => {
    const flush = () => {
      if (!document.hidden) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      savePlanningState();
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [savePlanningState]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectTimestep = useCallback(
    (t: number) => {
      // Cancel any in-flight load
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;

      // Lock save key to current sessionName so later name edits don't create phantom files
      setLoadedSessionName(sessionName);

      // Block auto-save until load completes
      isLoaded.current = false;

      let mentee: UserModel;
      let mentor: UserModel;
      if (t === 0 || steps.length === 0) {
        mentee = JSON.parse(JSON.stringify(EMPTY_MODEL));
        mentor = JSON.parse(JSON.stringify(EMPTY_MODEL));
      } else {
        const step = steps[t - 1];
        mentee = JSON.parse(JSON.stringify(step.menteeModelAfter));
        mentor = JSON.parse(JSON.stringify(step.mentorModelAfter));
      }
      setTimestep(t);
      setError(null);
      setStatus(null);
      setPrevMenteeModel(null);
      setPrevMentorModel(null);
      setWorkspace(null);
      setActiveRunIndex(null);
      setReplayState(null);
      setMenteeModel(mentee);
      setMentorModel(mentor);
      setMessages([]);
      setLastUpdateAt(0);
      setRuns([]);

      // Load chat state + runs from server
      const key = `planning-chat-${sessionName || "unsaved"}-t${t}`;

      // Load main chat state
      const loadChat = fetch(
        `/api/planning/${encodeURIComponent(key)}`,
        { signal: controller.signal }
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (controller.signal.aborted || !data) return;
          setMessages(data.messages || []);
          if (data.menteeModel) setMenteeModel(data.menteeModel);
          if (data.mentorModel) setMentorModel(data.mentorModel);
          // Reset zombie "researching" domains
          if (data.workspace?.domains) {
            for (const d of data.workspace.domains) {
              if (d.status === "researching") d.status = "not started";
            }
          }
          setWorkspace(data.workspace || null);
          if (typeof data.matchThreshold === "number") setMatchThreshold(data.matchThreshold);
          setLastUpdateAt(data.messages?.length || 0);
        });

      // Load replay runs from server
      const loadRuns = async () => {
        const restoredRuns: PlanningRun[] = [];
        for (let runIdx = 1; runIdx <= 20; runIdx++) {
          if (controller.signal.aborted) break;
          const runKey = `${key}-run${runIdx}`;
          try {
            const res = await fetch(
              `/api/planning/${encodeURIComponent(runKey)}`,
              { signal: controller.signal }
            );
            if (!res.ok) break;
            restoredRuns.push(await res.json());
          } catch { break; }
        }
        if (!controller.signal.aborted) setRuns(restoredRuns);
      };

      Promise.all([loadChat, loadRuns()])
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) {
            isLoaded.current = true;
          }
        });
    },
    [steps, sessionName]
  );

  // Incremental scoring: deduplicate globally, score only new resources, parallel batches (max 3)
  const handleScoreIncremental = useCallback(async () => {
    if (!workspace || scoring) return;
    const explored = workspace.domains.filter(
      (d) => d.status === "explored" && d.resources.length > 0
    );
    if (explored.length === 0) return;

    // Step 1: deduplicate (fast, no API call)
    const deduped = deduplicateResources(explored);

    // Fast path: if dimensions exist and nothing new to score, exit before setting scoring=true
    const existingDimensions = workspace.dimensions?.length ? workspace.dimensions : undefined;
    if (existingDimensions) {
      const unscored = findUnscoredResources(deduped, workspace.scoredResources || []);
      if (unscored.length === 0) return;
    }

    setScoring(true);
    setError(null);

    try {
      const { text: menteeText } = serializeModelWithIds(menteeModel, "M");

      // Step 2: ensure dimensions (generate only if absent)
      let dimensions = existingDimensions;
      if (!dimensions) {
        const dimPrompt = fillPrompt(
          prompts.planningDimensions || DEFAULT_PROMPTS.planningDimensions || "",
          {
            menteeModel: menteeText || "(empty)",
            constraints: JSON.stringify([
              ...(workspace.constraints.hard || []),
              ...(workspace.constraints.soft || []),
            ]),
            goal: workspace.goal,
          }
        );
        const dimRes = await callClaude(dimPrompt, undefined, modelSettings.updateModel);
        if (dimRes.error) {
          setError(`Dimension generation failed: ${dimRes.error}`);
          return;
        }
        dimensions = extractJSONArray(dimRes.output) as unknown as ScoringDimension[];
        setWorkspace((prev) => (prev ? { ...prev, dimensions } : prev));
      }

      // Step 3: find unscored (re-check after dim generation — if new, all resources are unscored)
      const unscored = findUnscoredResources(deduped, workspace.scoredResources || []);
      if (unscored.length === 0) return;

      // Step 4: group unscored by primary domain, score in parallel chunks of 3
      const byDomain = new Map<string, typeof unscored>();
      for (const r of unscored) {
        const key = r.domains[0] || "unknown";
        if (!byDomain.has(key)) byDomain.set(key, []);
        byDomain.get(key)!.push(r);
      }

      const domainGroups = Array.from(byDomain.values());
      const CONCURRENCY = 3;
      const allScored: ScoredResource[] = [];
      const batchErrors: string[] = [];

      for (let i = 0; i < domainGroups.length; i += CONCURRENCY) {
        const chunk = domainGroups.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (batch) => {
            const scorePrompt = fillPrompt(
              prompts.planningFilter || DEFAULT_PROMPTS.planningFilter || "",
              {
                menteeModel: menteeText || "(empty)",
                dimensions: JSON.stringify(dimensions),
                resources: JSON.stringify(batch),
              }
            );
            const res = await callClaude(scorePrompt, undefined, modelSettings.updateModel);
            if (res.error) {
              const domainName = batch[0]?.domains?.[0] || "unknown domain";
              batchErrors.push(`${domainName}: ${res.error}`);
              return [] as ScoredResource[];
            }
            const scored = extractJSONArray(res.output) as unknown as ScoredResource[];
            for (const s of scored) {
              const orig = batch.find((r) => r.url === s.url || r.title === s.title);
              if (orig) s.domains = orig.domains;
            }
            return scored;
          })
        );
        allScored.push(...results.flat());
      }

      if (batchErrors.length > 0) {
        setError(
          `Scored ${allScored.length} resources; ${batchErrors.length} batch(es) failed:\n${batchErrors.join("\n")}`
        );
      }

      // Step 5: append with dedup guard
      setWorkspace((prev) => {
        if (!prev) return prev;
        const existing = prev.scoredResources || [];
        const norm = (s: string) => s?.toLowerCase().replace(/\/+$/, "").trim() || "";
        const existingUrls = new Set(existing.map((s) => norm(s.url)));
        const existingTitles = new Set(existing.map((s) => norm(s.title)));
        const toAdd = allScored.filter(
          (s) => !existingUrls.has(norm(s.url)) && !existingTitles.has(norm(s.title))
        );
        return { ...prev, dimensions, scoredResources: [...existing, ...toAdd] };
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setScoring(false);
    }
  }, [workspace, scoring, prompts, menteeModel, modelSettings]);

  // Eagerly generate scoring dimensions in parallel with research
  // Only needs mentee model + constraints — no dependency on research results
  const handleGenerateDimensions = useCallback(async (ws: PlanningWorkspace) => {
    if (!ws || (ws.dimensions && ws.dimensions.length > 0)) return; // already have dimensions
    try {
      const { text: menteeText } = serializeModelWithIds(menteeModel, "M");
      const dimPrompt = fillPrompt(prompts.planningDimensions || DEFAULT_PROMPTS.planningDimensions || "", {
        menteeModel: menteeText || "(empty)",
        constraints: JSON.stringify([...(ws.constraints.hard || []), ...(ws.constraints.soft || [])]),
        goal: ws.goal,
      });
      const dimRes = await callClaude(dimPrompt, undefined, modelSettings.updateModel);
      if (!dimRes.error) {
        const dimensions = extractJSONArray(dimRes.output) as unknown as ScoringDimension[];
        setWorkspace((prev) => prev ? { ...prev, dimensions } : prev);
      }
    } catch (err) {
      console.warn("Eager dimension generation failed:", err);
    }
  }, [menteeModel, prompts, modelSettings]);

  // Research a single domain via Opus + WebSearch (supports parallel calls)
  const handleResearch = useCallback(async (domainName: string, workspaceOverride?: PlanningWorkspace) => {
    const ws = workspaceOverride ?? workspace;
    if (!ws) return;
    // Skip if already researching or explored
    if (researching.has(domainName)) return;
    const domainObj = ws.domains.find((d) => d.name === domainName);
    if (domainObj && domainObj.status === "explored") return;

    // Mark as researching
    researchStartTimes.current.set(domainName, Date.now());
    setResearching((prev) => new Set([...prev, domainName]));
    setError(null);

    // Update workspace domain status
    setWorkspace((prev) => {
      if (!prev) return prev;
      const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
      const d = updated.domains.find((dd) => dd.name === domainName);
      if (d) d.status = "researching";
      return updated;
    });

    try {
      const { text: rMenteeText } = serializeModelWithIds(menteeModel, "M");
      const { text: rMentorText } = serializeModelWithIds(mentorModel, "T");
      const researchPrompt = fillPrompt(prompts.planningResearch || "", {
        menteeModel: rMenteeText || "(empty)",
        mentorModel: rMentorText || "(empty)",
        domain: domainName,
        constraints: JSON.stringify([...(ws.constraints.hard || []), ...(ws.constraints.soft || [])]),
        goal: ws.goal,
        workspace: JSON.stringify(ws, null, 2),
      });

      const res = await callClaude(
        researchPrompt,
        undefined,
        modelSettings.updateModel,
        ["WebSearch", "WebFetch"]
      );

      if (res.error) {
        setError(res.error);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
          const d = updated.domains.find((dd) => dd.name === domainName);
          if (d) d.status = "not started";
          return updated;
        });
        return;
      }

      const resources = extractJSONArray(res.output);

      // Store resources and mark as explored (scoring happens globally via handleScoreAll)
      setWorkspace((prev) => {
        if (!prev) return prev;
        const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
        const d = updated.domains.find((dd) => dd.name === domainName);
        if (d) {
          d.resources = resources;
          d.status = "explored";
        }
        updated.currentFocus = domainName;
        return updated;
      });

      // Pipeline: score this domain's resources immediately (don't wait for all domains)
      handleScoreIncremental();

    } catch (err) {
      console.error("Research error:", err);
      setError(String(err));
      setWorkspace((prev) => {
        if (!prev) return prev;
        const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
        const d = updated.domains.find((dd) => dd.name === domainName);
        if (d) d.status = "not started";
        return updated;
      });
    } finally {
      researchStartTimes.current.delete(domainName);
      setResearching((prev) => {
        const next = new Set(prev);
        next.delete(domainName);
        return next;
      });
    }
  }, [workspace, researching, prompts, menteeModel, modelSettings, handleScoreIncremental]);

  // Research all "not started" domains in parallel
  const handleResearchAll = useCallback(() => {
    if (!workspace) return;
    const notStarted = workspace.domains.filter((d) => d.status === "not started");
    notStarted.forEach((d) => handleResearch(d.name));
  }, [workspace, handleResearch]);

  // Score all resources globally: deduplicate → generate facets → per-dimension scoring
  const handleScoreAll = useCallback(async () => {
    if (!workspace || scoring) return;
    const explored = workspace.domains.filter((d) => d.status === "explored" && d.resources.length > 0);
    if (explored.length === 0) return;

    setScoring(true);
    setError(null);

    try {
      // Step 1: Deduplicate resources across domains
      const deduped = deduplicateResources(explored);

      // Step 2: Generate scoring dimensions from model
      const { text: menteeText } = serializeModelWithIds(menteeModel, "M");
      const dimPrompt = fillPrompt(prompts.planningDimensions || DEFAULT_PROMPTS.planningDimensions || "", {
        menteeModel: menteeText || "(empty)",
        constraints: JSON.stringify([...(workspace.constraints.hard || []), ...(workspace.constraints.soft || [])]),
        goal: workspace.goal,
      });

      const dimRes = await callClaude(dimPrompt, undefined, modelSettings.updateModel);
      if (dimRes.error) {
        setError(`Dimension generation failed: ${dimRes.error}`);
        return;
      }
      const dimensions = extractJSONArray(dimRes.output) as unknown as ScoringDimension[];

      // Store dimensions immediately
      setWorkspace((prev) => {
        if (!prev) return prev;
        return { ...prev, dimensions };
      });

      // Step 3: Score all resources in parallel batches
      const allScored = await scoreBatchesInParallel(deduped, dimensions, menteeText, prompts, modelSettings);

      // Store scored resources
      setWorkspace((prev) => {
        if (!prev) return prev;
        return { ...prev, dimensions, scoredResources: allScored };
      });

    } catch (err) {
      console.error("Score all error:", err);
      setError(String(err));
    } finally {
      setScoring(false);
    }
  }, [workspace, scoring, prompts, menteeModel, modelSettings]);

  // Rescore only: keep existing dimensions, re-run scoring against current model
  const handleRescoreAll = useCallback(async () => {
    if (!workspace || scoring) return;
    if (!workspace.dimensions || workspace.dimensions.length === 0) return;
    const explored = workspace.domains.filter((d) => d.status === "explored" && d.resources.length > 0);
    if (explored.length === 0) return;

    setScoring(true);
    setError(null);

    try {
      const deduped = deduplicateResources(explored);
      const { text: menteeText } = serializeModelWithIds(menteeModel, "M");
      const allScored = await scoreBatchesInParallel(
        deduped,
        workspace.dimensions,
        menteeText,
        prompts,
        modelSettings
      );

      setWorkspace((prev) => {
        if (!prev) return prev;
        return { ...prev, scoredResources: allScored };
      });
    } catch (err) {
      console.error("Rescore error:", err);
      setError(String(err));
    } finally {
      setScoring(false);
    }
  }, [workspace, scoring, prompts, menteeModel, modelSettings]);

  // Score/rescore a single explored domain's resources against the model (legacy)
  const handleScoreDomain = useCallback(async (domainName: string) => {
    if (!workspace) return;
    if (!(prompts.planningFilter || DEFAULT_PROMPTS.planningFilter)) {
      console.warn("planningFilter prompt not found — reload the page to pick up new prompts");
      setError("planningFilter prompt not available. Try reloading the page.");
      return;
    }
    const domainObj = workspace.domains.find((d) => d.name === domainName);
    if (!domainObj || domainObj.resources.length === 0) return;
    if (researching.has(domainName)) return; // reuse researching set for scoring-in-progress

    researchStartTimes.current.set(domainName, Date.now());
    setResearching((prev) => new Set([...prev, domainName]));

    setWorkspace((prev) => {
      if (!prev) return prev;
      const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
      const d = updated.domains.find((dd) => dd.name === domainName);
      if (d) d.status = "filtering";
      return updated;
    });

    try {
      const { text: fMenteeText } = serializeModelWithIds(menteeModel, "M");
      const filterPrompt = fillPrompt((prompts.planningFilter || DEFAULT_PROMPTS.planningFilter), {
        menteeModel: fMenteeText || "(empty)",
        constraints: JSON.stringify([...(workspace.constraints.hard || []), ...(workspace.constraints.soft || [])]),
        goal: workspace.goal,
        resources: JSON.stringify(domainObj.resources),
      });

      const filterRes = await callClaude(filterPrompt, undefined, modelSettings.updateModel);
      if (filterRes.error) {
        setError(filterRes.error);
      } else {
        const filtered = extractJSONArray(filterRes.output);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
          const d = updated.domains.find((dd) => dd.name === domainName);
          if (d) {
            d.filtered = filtered as PlanningWorkspace["domains"][0]["filtered"];
            d.status = "explored";
          }
          return updated;
        });
      }
    } catch (err) {
      console.error("Score error:", err);
      setError(String(err));
    } finally {
      researchStartTimes.current.delete(domainName);
      setResearching((prev) => {
        const next = new Set(prev);
        next.delete(domainName);
        return next;
      });
      // Restore status to explored if it was left as filtering
      setWorkspace((prev) => {
        if (!prev) return prev;
        const updated: PlanningWorkspace = JSON.parse(JSON.stringify(prev));
        const d = updated.domains.find((dd) => dd.name === domainName);
        if (d && d.status === "filtering") d.status = "explored";
        return updated;
      });
    }
  }, [workspace, researching, prompts, menteeModel, modelSettings]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || sending) return;
    const userMsg = inputText.trim();
    setInputText("");
    setSending(true);
    setError(null);

    // Add user message to chat
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userMsg },
    ];
    setMessages(newMessages);

    try {
      let currentMentee = menteeModel;
      let currentMentor = mentorModel;

      // Skip model update for short navigational messages — they rarely contain new mentee info.
      // Saves ~10s (2 Claude calls) per turn for messages like "yes", "let's explore X", etc.
      const isNavigational =
        userMsg.length < 100 ||
        /^(yes|no|yeah|nope|okay|ok|sure|got it|sounds good|let'?s|explore|research|what about|go ahead|perfect|great|that works)/i.test(
          userMsg.trim()
        );

      // Auto model update: extract deltas from the user message before AI response
      if (autoUpdate === "auto" && !isNavigational) {
        setPrevMenteeModel(JSON.parse(JSON.stringify(currentMentee)));
        setPrevMentorModel(JSON.parse(JSON.stringify(currentMentor)));
        setStatus("Updating models...");
        const [menteeResult, mentorResult] = await Promise.all([
          updateModel(
            currentMentee,
            userMsg,
            "mentee",
            mode,
            prompts,
            modelSettings.updateModel
          ),
          updateModel(
            currentMentor,
            userMsg,
            "mentor",
            mode,
            prompts,
            modelSettings.updateModel
          ),
        ]);
        currentMentee = menteeResult.newModel;
        currentMentor = mentorResult.newModel;
        setMenteeModel(currentMentee);
        setMentorModel(currentMentor);
        setLastUpdateAt(newMessages.length);
      }

      // Build system prompt
      setStatus("Generating response...");

      // Serialize models with numbered IDs for citations
      const { text: menteeText, lookup: menteeLookup } = serializeModelWithIds(currentMentee, "M");
      const { text: mentorText, lookup: mentorLookup } = serializeModelWithIds(currentMentor, "T");
      const refLookup = { ...menteeLookup, ...mentorLookup };

      if (useWorkspace && prompts.planningConversation) {
        // Phased protocol with workspace
        const systemPrompt = fillPrompt(prompts.planningConversation, {
          menteeModel: menteeText || "(empty)",
          mentorModel: mentorText || "(empty)",
          workspace: workspace ? JSON.stringify(workspace, null, 2) : "null",
        });

        const conversationPrompt = buildConversationPrompt(newMessages);

        const res = await callClaude(
          conversationPrompt,
          systemPrompt,
          modelSettings.chatModel
        );

        if (res.error) {
          setError(res.error);
        } else {
          // Parse workspace from response (full or delta)
          const { chatText, workspace: newWorkspace, workspaceDelta } = splitWorkspaceResponse(res.output);

          setMessages([
            ...newMessages,
            { role: "assistant", content: chatText, systemPrompt, rawOutput: res.output, refLookup },
          ]);

          if (newWorkspace) {
            // Full workspace (first turn)
            setWorkspace(newWorkspace);
            const notStarted = newWorkspace.domains.filter((d) => d.status === "not started");
            // Fire research directly with newWorkspace to avoid stale closure reads
            notStarted.forEach((d) => handleResearch(d.name, newWorkspace));
            // Start dimension generation in parallel with research
            if (notStarted.length > 0) {
              handleGenerateDimensions(newWorkspace);
            }
          } else if (workspaceDelta) {
            // Delta update — merge into existing
            // Compute merged workspace inline to fire research directly (avoids stale closure)
            const mergedWorkspace = workspace ? applyWorkspaceDelta(workspace, workspaceDelta) : null;
            if (mergedWorkspace) {
              setWorkspace(mergedWorkspace);
              const notStarted = mergedWorkspace.domains.filter(
                (d) => d.status === "not started" && !researching.has(d.name)
              );
              notStarted.forEach((d) => handleResearch(d.name, mergedWorkspace));
            }
          }
        }
      } else {
        // Fallback: no workspace, simple conversation
        const systemPrompt = fillPrompt(prompts.planningConversation || prompts.planningSystem || "", {
          menteeModel: menteeText || "(empty)",
          mentorModel: mentorText || "(empty)",
          workspace: "null",
        });

        const conversationPrompt = buildConversationPrompt(newMessages);

        const res = await callClaude(
          conversationPrompt,
          systemPrompt,
          modelSettings.chatModel
        );

        if (res.error) {
          setError(res.error);
        } else {
          setMessages([
            ...newMessages,
            { role: "assistant", content: res.output, systemPrompt, rawOutput: res.output, refLookup },
          ]);
        }
      }
    } catch (err) {
      console.error("Planning error:", err);
      setError(String(err));
    } finally {
      setSending(false);
      setStatus(null);
    }
  }, [
    inputText,
    sending,
    messages,
    menteeModel,
    mentorModel,
    autoUpdate,
    mode,
    prompts,
    modelSettings,
    workspace,
    researching,
    useWorkspace,
    handleResearch,
    handleGenerateDimensions,
  ]);

  const handleManualUpdate = useCallback(async () => {
    if (autoUpdate === "off") return;
    const newUserMessages = messages
      .filter((m, i) => m.role === "user" && i >= lastUpdateAt)
      .map((m) => m.content)
      .join("\n\n---\n\n");
    if (!newUserMessages.trim()) return;

    setSending(true);
    setStatus("Updating models...");
    setError(null);
    setPrevMenteeModel(JSON.parse(JSON.stringify(menteeModel)));
    setPrevMentorModel(JSON.parse(JSON.stringify(mentorModel)));
    try {
      const [menteeResult, mentorResult] = await Promise.all([
        updateModel(
          menteeModel,
          newUserMessages,
          "mentee",
          mode,
          prompts,
          modelSettings.updateModel
        ),
        updateModel(
          mentorModel,
          newUserMessages,
          "mentor",
          mode,
          prompts,
          modelSettings.updateModel
        ),
      ]);
      setMenteeModel(menteeResult.newModel);
      setMentorModel(mentorResult.newModel);
      setLastUpdateAt(messages.length);
    } catch (err) {
      console.error("Update models error:", err);
      setError(String(err));
    } finally {
      setSending(false);
      setStatus(null);
    }
  }, [
    messages,
    lastUpdateAt,
    menteeModel,
    mentorModel,
    autoUpdate,
    mode,
    prompts,
    modelSettings,
  ]);

  // Replay: re-send user messages with current prompts, producing a new run
  const handleReplay = useCallback(async () => {
    const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
    if (userMessages.length === 0 || sending || replayState) return;

    const promptSnapshot = { ...prompts };
    const newRunIndex = runs.length + 1;

    // Get starting models from timestep
    let startMentee: UserModel;
    let startMentor: UserModel;
    if (timestep === 0 || steps.length === 0) {
      startMentee = JSON.parse(JSON.stringify(EMPTY_MODEL));
      startMentor = JSON.parse(JSON.stringify(EMPTY_MODEL));
    } else {
      const step = steps[timestep! - 1];
      startMentee = JSON.parse(JSON.stringify(step.menteeModelAfter));
      startMentor = JSON.parse(JSON.stringify(step.mentorModelAfter));
    }

    replayCancelledRef.current = false;
    setReplayState({ running: true, currentStep: 0, totalSteps: userMessages.length });
    setSending(true);
    setError(null);

    const replayMessages: ChatMessage[] = [];
    let currentWorkspace: PlanningWorkspace | null = null;

    try {
      for (let i = 0; i < userMessages.length; i++) {
        if (replayCancelledRef.current) break;
        setReplayState({ running: true, currentStep: i + 1, totalSteps: userMessages.length });

        replayMessages.push({ role: "user", content: userMessages[i] });

        const { text: rpMenteeText, lookup: rpMenteeLookup } = serializeModelWithIds(startMentee, "M");
        const { text: rpMentorText, lookup: rpMentorLookup } = serializeModelWithIds(startMentor, "T");
        const rpRefLookup = { ...rpMenteeLookup, ...rpMentorLookup };

        const sysPrompt = fillPrompt(promptSnapshot.planningConversation || "", {
          menteeModel: rpMenteeText || "(empty)",
          mentorModel: rpMentorText || "(empty)",
          workspace: currentWorkspace ? JSON.stringify(currentWorkspace, null, 2) : "null",
        });

        const conversationPrompt = buildConversationPrompt(replayMessages);
        const res = await callClaude(conversationPrompt, sysPrompt, modelSettings.chatModel);

        if (res.error) {
          setError(`Replay failed at message ${i + 1}: ${res.error}`);
          break;
        }

        const { chatText, workspace: newWorkspace, workspaceDelta: rpDelta } = splitWorkspaceResponse(res.output);
        replayMessages.push({
          role: "assistant",
          content: chatText,
          systemPrompt: sysPrompt,
          rawOutput: res.output,
          refLookup: rpRefLookup,
        });
        if (newWorkspace) {
          currentWorkspace = newWorkspace;
        } else if (rpDelta && currentWorkspace) {
          currentWorkspace = applyWorkspaceDelta(currentWorkspace, rpDelta);
        }
      }

      if (!replayCancelledRef.current) {
        const newRun: PlanningRun = {
          runIndex: newRunIndex,
          label: `Run ${newRunIndex}`,
          prompts: promptSnapshot,
          messages: replayMessages,
          menteeModel: startMentee,
          mentorModel: startMentor,
          workspace: currentWorkspace,
          createdAt: Date.now(),
        };

        setRuns((prev) => [...prev, newRun]);
        setActiveRunIndex(newRunIndex);

        // Save to server
        const runKey = `planning-chat-${sessionName || "unsaved"}-t${timestep}-run${newRunIndex}`;
        fetch(`/api/planning/${encodeURIComponent(runKey)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newRun),
        }).catch((e) => console.warn("Run save failed:", e));
      }
    } catch (err) {
      console.error("Replay error:", err);
      setError(String(err));
    } finally {
      setReplayState(null);
      setSending(false);
    }
  }, [messages, sending, replayState, prompts, runs, timestep, steps, modelSettings, sessionName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasNewUserMessages =
    messages.filter((m, i) => m.role === "user" && i >= lastUpdateAt).length > 0;

  // Derived: what to display based on active run
  const activeRun = activeRunIndex !== null ? runs.find((r) => r.runIndex === activeRunIndex) : null;
  const displayMessages = activeRun ? activeRun.messages : messages;
  const displayMenteeModel = activeRun ? activeRun.menteeModel : menteeModel;
  const displayMentorModel = activeRun ? activeRun.mentorModel : mentorModel;
  const displayWorkspace = activeRun ? activeRun.workspace : workspace;
  const isViewingRun = activeRun !== null;

  // Prompt diff: which prompts differ between active run and current
  const promptDiffs = activeRun
    ? Object.keys(activeRun.prompts).filter((k) => activeRun.prompts[k] !== prompts[k])
    : [];

  return (
    <>
    <style>{MD_STYLES}</style>
    <div
      style={{
        padding: 20,
        maxWidth: 1600,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header: timestep selector + toggles (hidden in focus mode) */}
      {!focusMode && <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {/* Timestep buttons */}
        <span
          style={{
            fontSize: 12,
            color: PALETTE.inkMuted,
            fontFamily: FONT_HEADING,
          }}
        >
          Timestep:
        </span>
        {steps.length === 0 ? (
          <button
            onClick={() => selectTimestep(0)}
            style={{
              padding: "4px 10px",
              border: `1px solid ${timestep === 0 ? PALETTE.amber : PALETTE.sand}`,
              borderRadius: 4,
              fontSize: 12,
              cursor: "pointer",
              background: timestep === 0 ? PALETTE.amberGlow : "transparent",
              color: timestep === 0 ? PALETTE.amber : PALETTE.inkMuted,
            }}
          >
            Empty
          </button>
        ) : (
          Array.from({ length: steps.length + 1 }, (_, i) => (
            <button
              key={i}
              onClick={() => selectTimestep(i)}
              style={{
                padding: "4px 10px",
                border: `1px solid ${timestep === i ? PALETTE.amber : PALETTE.sand}`,
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
                background: timestep === i ? PALETTE.amberGlow : "transparent",
                color: timestep === i ? PALETTE.amber : PALETTE.inkMuted,
              }}
            >
              t={i}
            </button>
          ))
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Workspace toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: PALETTE.inkMuted,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={useWorkspace}
            onChange={(e) => setUseWorkspace(e.target.checked)}
            style={{ margin: 0 }}
          />
          Workspace
        </label>

        {/* Match threshold */}
        <span style={{ fontSize: 12, color: PALETTE.inkMuted, display: "flex", alignItems: "center", gap: 4 }}>
          Fit ≥
          <input
            type="range" min={0} max={1} step={0.05}
            value={matchThreshold}
            onChange={(e) => setMatchThreshold(parseFloat(e.target.value))}
            style={{ width: 60, accentColor: PALETTE.teal }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: PALETTE.teal, minWidth: 24 }}>
            {matchThreshold.toFixed(2)}
          </span>
        </span>

        {/* View toggle: Table / List */}
        <div style={{ display: "flex", gap: 0, borderRadius: 6, overflow: "hidden", border: `1px solid ${PALETTE.sand}` }}>
          {(["table", "list"] as const).map((v) => (
            <button key={v} onClick={() => setBadgeView(v)} style={{
              fontSize: 10, padding: "3px 10px", border: "none",
              background: badgeView === v ? PALETTE.teal : PALETTE.white,
              color: badgeView === v ? PALETTE.white : PALETTE.inkMuted,
              fontWeight: 600, cursor: "pointer", fontFamily: FONT_BODY,
              textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              {v}
            </button>
          ))}
        </div>

        {/* Auto-update toggle */}
        <span style={{ fontSize: 12, color: PALETTE.inkMuted }}>
          Model Updates:
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          {(["auto", "manual", "off"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setAutoUpdate(m)}
              style={{
                padding: "3px 10px",
                border: `1px solid ${autoUpdate === m ? PALETTE.teal : PALETTE.sand}`,
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
                background: autoUpdate === m ? PALETTE.tealBg : "transparent",
                color: autoUpdate === m ? PALETTE.teal : PALETTE.inkMuted,
              }}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Clear chat */}
        {messages.length > 0 && !isViewingRun && (
          <button
            onClick={() => {
              setMessages([]);
              setLastUpdateAt(0);
              setWorkspace(null);
              if (storageKey) {
                fetch(`/api/planning/${encodeURIComponent(storageKey)}`, { method: "DELETE" }).catch(() => {});
              }
              if (timestep !== null) selectTimestep(timestep);
            }}
            style={{
              padding: "3px 10px",
              border: `1px solid ${PALETTE.rose}`,
              borderRadius: 4,
              fontSize: 12,
              color: PALETTE.rose,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Clear Chat
          </button>
        )}
      </div>}

      {/* No timestep selected */}
      {!focusMode && timestep === null && (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: PALETTE.inkMuted,
            fontStyle: "italic",
          }}
        >
          {steps.length === 0
            ? 'Process notes in the Update tab first, or click "Empty" to start with empty models.'
            : "Select a timestep to start planning."}
        </div>
      )}

      {/* Run selector strip */}
      {!focusMode && timestep !== null && (runs.length > 0 || messages.length > 0) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {/* Original tab */}
          <button
            onClick={() => setActiveRunIndex(null)}
            style={{
              padding: "4px 10px",
              border: `1px solid ${!isViewingRun ? PALETTE.teal : PALETTE.sand}`,
              borderRadius: 4,
              fontSize: 12,
              cursor: "pointer",
              background: !isViewingRun ? PALETTE.tealBg : "transparent",
              color: !isViewingRun ? PALETTE.teal : PALETTE.inkMuted,
              fontWeight: !isViewingRun ? 600 : 400,
            }}
          >
            Original
          </button>

          {/* Run tabs */}
          {runs.map((run) => (
            <button
              key={run.runIndex}
              onClick={() => setActiveRunIndex(run.runIndex)}
              style={{
                padding: "4px 10px",
                border: `1px solid ${activeRunIndex === run.runIndex ? PALETTE.teal : PALETTE.sand}`,
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
                background: activeRunIndex === run.runIndex ? PALETTE.tealBg : "transparent",
                color: activeRunIndex === run.runIndex ? PALETTE.teal : PALETTE.inkMuted,
                fontWeight: activeRunIndex === run.runIndex ? 600 : 400,
              }}
            >
              {run.label}
            </button>
          ))}

          {/* Replay button */}
          {messages.length > 0 && !replayState && (
            <button
              onClick={handleReplay}
              disabled={sending}
              style={{
                padding: "4px 10px",
                border: `1px solid ${PALETTE.amber}`,
                borderRadius: 4,
                fontSize: 12,
                cursor: sending ? "default" : "pointer",
                background: "transparent",
                color: sending ? PALETTE.inkMuted : PALETTE.amber,
                fontWeight: 600,
              }}
            >
              + Replay
            </button>
          )}

          {/* Replay progress */}
          {replayState && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ color: PALETTE.teal }}>
                Replaying {replayState.currentStep}/{replayState.totalSteps}...
              </span>
              <div style={{ width: 80, height: 6, background: PALETTE.sand, borderRadius: 3 }}>
                <div
                  style={{
                    width: `${(replayState.currentStep / replayState.totalSteps) * 100}%`,
                    height: "100%",
                    background: PALETTE.teal,
                    borderRadius: 3,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <button
                onClick={() => { replayCancelledRef.current = true; }}
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  border: `1px solid ${PALETTE.rose}`,
                  borderRadius: 4,
                  background: "transparent",
                  color: PALETTE.rose,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Prompt diff pills */}
          {promptDiffs.length > 0 && (
            <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
              {promptDiffs.map((k) => (
                <span
                  key={k}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 8,
                    background: PALETTE.amberGlow,
                    color: PALETTE.amber,
                    fontWeight: 600,
                  }}
                >
                  {k} changed
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Viewing run banner */}
      {isViewingRun && (
        <div
          style={{
            padding: "6px 12px",
            background: PALETTE.tealBg,
            borderRadius: 8,
            fontSize: 12,
            color: PALETTE.teal,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Viewing {activeRun!.label} (read-only) — click Original to continue conversation
        </div>
      )}

      {/* Main layout */}
      {(timestep !== null || focusMode) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: useWorkspace ? "1fr 2fr 1fr" : "1fr 3fr",
            gap: 12,
            height: focusMode ? "calc(100vh - 40px)" : "calc(100vh - 200px)",
          }}
        >
          {/* Left pane: both models stacked */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              overflow: "hidden",
            }}
          >
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <ModelViewComponent
                model={displayMenteeModel}
                view={modelView}
                label="mentee"
                showEvidence={false}
                previousModel={isViewingRun ? undefined : (prevMenteeModel || undefined)}
              />
            </div>
            <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <ModelViewComponent
                model={displayMentorModel}
                view={modelView}
                label="mentor"
                showEvidence={false}
                previousModel={isViewingRun ? undefined : (prevMentorModel || undefined)}
              />
            </div>
          </div>

          {/* Chat column */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: PALETTE.white,
              border: `1px solid ${PALETTE.sand}`,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {/* Chat header */}
            <div
              style={{
                padding: "8px 16px",
                borderBottom: `1px solid ${PALETTE.sand}`,
                background: PALETTE.parchment,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1.5,
                color: PALETTE.inkMuted,
              }}
            >
              Planning Chat
              <span style={{ textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>
                · {modelSettings.chatModel}
                {useWorkspace && " · workspace"}
              </span>
              {status && (
                <span style={{ marginLeft: 12, color: PALETTE.teal }}>
                  {status}
                </span>
              )}
              {researching.size > 0 && (
                <span style={{ marginLeft: 12, color: PALETTE.amber, textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }}>
                  Researching {researching.size} domain{researching.size !== 1 ? "s" : ""}...
                </span>
              )}
            </div>

            {/* Messages */}
            <div
              style={{
                flex: badgeExpanded ? "none" : 1,
                height: badgeExpanded ? "50%" : undefined,
                overflow: "auto",
                padding: "12px 16px 0 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {displayMessages.length === 0 && (
                <div
                  style={{
                    color: PALETTE.inkMuted,
                    fontStyle: "italic",
                    textAlign: "center",
                    padding: 20,
                    fontSize: 13,
                  }}
                >
                  Start a planning conversation. Describe a goal or situation
                  for the mentee.
                </div>
              )}
              {displayMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent:
                      msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  {msg.role === "user" ? (
                    <div
                      style={{
                        maxWidth: "85%",
                        padding: "10px 14px",
                        borderRadius: 12,
                        fontSize: 13,
                        lineHeight: 1.6,
                        fontFamily: FONT_BODY,
                        whiteSpace: "pre-wrap",
                        background: PALETTE.amberGlow,
                        color: PALETTE.ink,
                        borderBottomRightRadius: 4,
                      }}
                    >
                      {msg.content}
                    </div>
                  ) : (
                    <AssistantMessageBubble msg={msg} />
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Research status bar — outside scroll, as sibling flex child */}
            {!isViewingRun && (
              <div style={{ flex: badgeExpanded ? 1 : "none", overflow: badgeExpanded ? "hidden" : "visible", display: "flex", flexDirection: "column" }}>
                <ResearchStatusBar workspace={displayWorkspace} researching={researching} matchThreshold={matchThreshold} onThresholdChange={setMatchThreshold} onScoreAll={isViewingRun ? undefined : handleScoreAll} scoring={scoring} badgeView={badgeView} onBadgeViewChange={setBadgeView} expanded={badgeExpanded} onExpandedChange={setBadgeExpanded} menteeModel={menteeModel} />
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                style={{
                  margin: "0 16px",
                  padding: "8px 12px",
                  background: "rgba(184,92,92,0.1)",
                  border: `1px solid ${PALETTE.rose}`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: PALETTE.rose,
                  flexShrink: 0,
                }}
              >
                {error}
                <button
                  onClick={() => setError(null)}
                  style={{
                    float: "right",
                    background: "none",
                    border: "none",
                    color: PALETTE.rose,
                    cursor: "pointer",
                  }}
                >
                  x
                </button>
              </div>
            )}

            {/* Input area — pinned to bottom (hidden when viewing a run) */}
            {!isViewingRun && (
            <div
              style={{
                padding: "6px 12px 8px",
                borderTop: `1px solid ${PALETTE.sand}`,
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                gap: 6,
              }}
            >
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe a goal or situation... (Cmd+Enter to send)"
                disabled={sending}
                style={{
                  border: `1px solid ${PALETTE.sand}`,
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 14,
                  fontFamily: FONT_BODY,
                  resize: "vertical",
                  minHeight: 60,
                  outline: "none",
                  color: PALETTE.ink,
                  background: PALETTE.parchment,
                  lineHeight: 1.5,
                }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || sending}
                  style={{
                    padding: "7px 16px",
                    background:
                      inputText.trim() && !sending
                        ? PALETTE.amber
                        : PALETTE.sand,
                    color:
                      inputText.trim() && !sending
                        ? PALETTE.white
                        : PALETTE.inkMuted,
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor:
                      inputText.trim() && !sending ? "pointer" : "default",
                  }}
                >
                  {sending ? (status || "Sending...") : "Send"}
                </button>

                {/* Update Models button (manual mode only) */}
                {autoUpdate === "manual" && (
                  <button
                    onClick={handleManualUpdate}
                    disabled={!hasNewUserMessages || sending}
                    style={{
                      padding: "7px 16px",
                      border: `1px solid ${hasNewUserMessages && !sending ? PALETTE.sage : PALETTE.sand}`,
                      borderRadius: 8,
                      fontSize: 13,
                      color:
                        hasNewUserMessages && !sending
                          ? PALETTE.sage
                          : PALETTE.inkMuted,
                      background: "transparent",
                      cursor:
                        hasNewUserMessages && !sending ? "pointer" : "default",
                    }}
                  >
                    Update Models
                  </button>
                )}

                {autoUpdate === "auto" && (
                  <span style={{ fontSize: 11, color: PALETTE.inkMuted }}>
                    Models update automatically before each response
                  </span>
                )}
                {autoUpdate === "off" && (
                  <span style={{ fontSize: 11, color: PALETTE.inkMuted }}>
                    Model updates disabled (frozen at timestep)
                  </span>
                )}
              </div>
            </div>
            )}
          </div>

          {/* Right pane: workspace (only when enabled) */}
          {useWorkspace && (
            <div style={{ overflow: "hidden" }}>
              <WorkspacePanel
                workspace={displayWorkspace}
                onDomainClick={isViewingRun ? undefined : handleResearch}
                onScoreDomain={isViewingRun ? undefined : handleScoreDomain}
                onResearchAll={isViewingRun ? undefined : handleResearchAll}
                onScoreAll={isViewingRun ? undefined : handleScoreAll}
                onRescoreAll={isViewingRun ? undefined : handleRescoreAll}
                scoring={scoring}
                researching={isViewingRun ? undefined : researching}
                researchStartTimes={researchStartTimes.current}
              />
            </div>
          )}
        </div>
      )}

    </div>
    </>
  );
}
