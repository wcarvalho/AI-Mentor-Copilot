import { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import type { PlanningWorkspace, WorkspaceDomain } from "../types";
import { PALETTE, FONT_HEADING, FONT_BODY } from "../theme";

// Inject pulse animation once
if (typeof document !== "undefined" && !document.getElementById("workspace-animations")) {
  const style = document.createElement("style");
  style.id = "workspace-animations";
  style.textContent = `
    @keyframes pulse-border {
      0%, 100% { border-color: ${PALETTE.sand}; }
      50% { border-color: ${PALETTE.amber}; }
    }
  `;
  document.head.appendChild(style);
}

interface Props {
  workspace: PlanningWorkspace | null;
  onDomainClick?: (domainName: string) => void;
  onScoreDomain?: (domainName: string) => void;
  onResearchAll?: () => void;
  onScoreAll?: () => void;
  onRescoreAll?: () => void;
  scoring?: boolean;
  researching?: Set<string>;
  researchStartTimes?: Map<string, number>;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  "not started": { bg: PALETTE.parchment, text: PALETTE.inkMuted, label: "Not started" },
  researching: { bg: PALETTE.amberGlow, text: PALETTE.amber, label: "Researching..." },
  filtering: { bg: PALETTE.amberGlow, text: PALETTE.amber, label: "Scoring..." },
  explored: { bg: PALETTE.tealBg, text: PALETTE.teal, label: "Explored" },
};

function RawToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        fontSize: 10,
        padding: "1px 5px",
        border: `1px solid ${active ? PALETTE.teal : PALETTE.sand}`,
        borderRadius: 4,
        background: active ? PALETTE.tealBg : "transparent",
        color: active ? PALETTE.teal : PALETTE.inkMuted,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      Raw
    </button>
  );
}

function RawJson({ data }: { data: unknown }) {
  return (
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
        borderTop: `1px solid ${PALETTE.sand}`,
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function DomainCard({
  domain,
  onClick,
  onScore,
  researching,
  startTime,
}: {
  domain: WorkspaceDomain;
  onClick?: () => void;
  onScore?: () => void;
  researching: boolean;
  startTime?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const isScoring = researching && domain.status === "filtering";
  const status = researching ? (isScoring ? "filtering" : "researching") : domain.status;
  const colors = STATUS_COLORS[status] || STATUS_COLORS["not started"];
  const clickable = !researching && domain.status === "not started" && onClick;

  // Elapsed timer for researching state
  useEffect(() => {
    if (!researching || !startTime) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - startTime) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [researching, startTime]);

  return (
    <div
      style={{
        border: `1px solid ${researching ? PALETTE.amber : PALETTE.sand}`,
        borderRadius: 8,
        overflow: "hidden",
        animation: researching ? "pulse-border 2s ease-in-out infinite" : undefined,
      }}
    >
      <div
        onClick={() => {
          if (clickable) onClick();
          else if ((domain.resources?.length || 0) > 0) setExpanded(!expanded);
        }}
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: clickable || (domain.resources?.length || 0) > 0 ? "pointer" : "default",
          background: PALETTE.white,
        }}
      >
        <span style={{ flex: 1, fontSize: 13, color: PALETTE.ink, fontWeight: 500 }}>
          {domain.name}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 10,
            background: colors.bg,
            color: colors.text,
            fontWeight: 600,
          }}
        >
          {researching
            ? (isScoring ? `Scoring... (${elapsed}s)` : `Researching... (${elapsed}s)`)
            : colors.label}
        </span>
        {(domain.resources?.length || 0) > 0 && (
          <span style={{ fontSize: 11, color: PALETTE.inkMuted }}>
            {domain.resources.length} found
            {" "}{expanded ? "−" : "+"}
          </span>
        )}
        <RawToggle active={showRaw} onClick={() => setShowRaw(!showRaw)} />
      </div>

      {showRaw && <RawJson data={domain} />}

      {!showRaw && expanded && (
        <div
          style={{
            borderTop: `1px solid ${PALETTE.sand}`,
            padding: "8px 12px",
            background: PALETTE.parchment,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {domain.filtered && domain.filtered.length > 0 ? (
            // Show scored/filtered resources
            domain.filtered.map((r, i) => (
              <div key={i} style={{
                fontSize: 12, lineHeight: 1.5, display: "flex", gap: 10, alignItems: "flex-start",
                padding: "6px 0", borderBottom: i < domain.filtered!.length - 1 ? `1px solid ${PALETTE.sand}` : "none",
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, flexShrink: 0, padding: "2px 7px", borderRadius: 6,
                  fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "center",
                  background: r.score >= 0.7 ? PALETTE.tealBg : r.score >= 0.4 ? PALETTE.amberGlow : PALETTE.parchment,
                  color: r.score >= 0.7 ? PALETTE.teal : r.score >= 0.4 ? PALETTE.amber : PALETTE.inkMuted,
                  border: `1px solid ${r.score >= 0.7 ? "rgba(74,143,143,0.2)" : r.score >= 0.4 ? "rgba(200,121,65,0.15)" : PALETTE.sand}`,
                }}>
                  {r.score.toFixed(1)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: PALETTE.teal, fontWeight: 600, textDecoration: "none", fontSize: 12 }}>
                    {r.title}
                  </a>
                  <div style={{ color: PALETTE.inkLight, marginTop: 2, fontSize: 11 }}>{r.oneLiner}</div>
                </div>
              </div>
            ))
          ) : (
            // Show raw resources (no filtering yet)
            domain.resources.map((r, i) => (
              <div key={i} style={{ fontSize: 12, lineHeight: 1.4 }}>
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  style={{ color: PALETTE.teal, fontWeight: 600, textDecoration: "none" }}>
                  {r.title}
                </a>
                {r.cost && <span style={{ color: PALETTE.inkMuted, marginLeft: 6 }}>({r.cost})</span>}
                <div style={{ color: PALETTE.inkLight, marginTop: 2 }}>{r.description}</div>
              </div>
            ))
          )}
        </div>
      )}

      {!showRaw && domain.summary && (
        <div
          style={{
            borderTop: `1px solid ${PALETTE.sand}`,
            padding: "6px 12px",
            fontSize: 12,
            color: PALETTE.inkLight,
            background: PALETTE.white,
          }}
        >
          {domain.summary}
        </div>
      )}
    </div>
  );
}

export function WorkspacePanel({ workspace, onDomainClick, onScoreDomain, onResearchAll, onScoreAll, onRescoreAll, scoring, researching, researchStartTimes }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [scoringElapsed, setScoringElapsed] = useState(0);
  const scoringStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (scoring) {
      scoringStartRef.current = Date.now();
      setScoringElapsed(0);
      const id = setInterval(() => {
        setScoringElapsed(Math.floor((Date.now() - (scoringStartRef.current || Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      scoringStartRef.current = null;
      setScoringElapsed(0);
    }
  }, [scoring]);

  if (!workspace) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          color: PALETTE.inkMuted,
          fontStyle: "italic",
          fontSize: 13,
          textAlign: "center",
          background: PALETTE.white,
          border: `1px solid ${PALETTE.sand}`,
          borderRadius: 12,
        }}
      >
        Workspace will appear as the conversation progresses.
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        background: PALETTE.white,
        border: `1px solid ${PALETTE.sand}`,
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Workspace header with raw toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: PALETTE.inkMuted,
          }}
        >
          Workspace
        </div>
        <RawToggle active={showRaw} onClick={() => setShowRaw(!showRaw)} />
      </div>

      {showRaw ? (
        <pre
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: PALETTE.ink,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            fontFamily: "monospace",
          }}
        >
          {JSON.stringify(workspace, null, 2)}
        </pre>
      ) : (
      <>
      {/* Goal */}
      <div>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: PALETTE.inkMuted,
            marginBottom: 4,
          }}
        >
          Goal
        </div>
        <div style={{ fontSize: 14, fontFamily: FONT_HEADING, color: PALETTE.ink }}>
          {workspace.goal || "—"}
        </div>
      </div>

      {/* Session Intent */}
      {workspace.sessionIntent && (
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: PALETTE.inkMuted,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Understanding
            {workspace.sessionIntent.confirmed && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 8,
                  background: PALETTE.tealBg,
                  color: PALETTE.teal,
                  fontWeight: 600,
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                confirmed
              </span>
            )}
          </div>
          {/* Confidence bar */}
          <div
            style={{
              width: "100%",
              height: 4,
              background: PALETTE.sand,
              borderRadius: 2,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                width: `${workspace.sessionIntent.confidence * 100}%`,
                height: "100%",
                background: workspace.sessionIntent.confirmed ? PALETTE.teal : PALETTE.amber,
                borderRadius: 2,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          {workspace.sessionIntent.looking_for?.length > 0 && (
            <div style={{ fontSize: 12, color: PALETTE.teal, marginBottom: 2 }}>
              {workspace.sessionIntent.looking_for.map((item, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  + {item}
                </div>
              ))}
            </div>
          )}
          {workspace.sessionIntent.not_looking_for?.length > 0 && (
            <div style={{ fontSize: 12, color: PALETTE.rose }}>
              {workspace.sessionIntent.not_looking_for.map((item, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  − {item}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Constraints */}
      {(workspace.constraints?.hard?.length > 0 || workspace.constraints?.soft?.length > 0 || workspace.constraints?.needed?.length > 0) && (
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: PALETTE.inkMuted,
              marginBottom: 4,
            }}
          >
            Constraints
          </div>
          {(workspace.constraints?.hard || []).map((c, i) => (
            <div key={`h-${i}`} style={{ fontSize: 12, color: PALETTE.teal, marginBottom: 2 }}>
              ✓ {c}
            </div>
          ))}
          {(workspace.constraints?.soft || []).map((c, i) => (
            <div key={`s-${i}`} style={{ fontSize: 12, color: PALETTE.inkLight, marginBottom: 2 }}>
              ~ {c}
            </div>
          ))}
          {(workspace.constraints?.needed || []).map((c, i) => (
            <div key={`n-${i}`} style={{ fontSize: 12, color: PALETTE.amber, marginBottom: 2 }}>
              ? {c}
            </div>
          ))}
        </div>
      )}

      {/* Domains */}
      {workspace.domains?.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: PALETTE.inkMuted,
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Domains
            {workspace.currentFocus && (
              <span
                style={{
                  textTransform: "none",
                  letterSpacing: 0,
                  color: PALETTE.teal,
                }}
              >
                · {workspace.currentFocus}
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
              {scoring && (
                <span style={{ fontSize: 10, color: PALETTE.amber, fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>
                  Scoring... ({scoringElapsed}s)
                </span>
              )}
              {onScoreAll && !workspace.scoredResources?.length && workspace.domains.some((d) => d.status === "explored" && d.resources.length > 0) && (
                <button
                  onClick={onScoreAll}
                  disabled={scoring}
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    border: `1px solid ${PALETTE.teal}`,
                    borderRadius: 10,
                    background: PALETTE.tealBg,
                    color: PALETTE.teal,
                    fontWeight: 600,
                    cursor: scoring ? "not-allowed" : "pointer",
                    opacity: scoring ? 0.5 : 1,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  Generate Comparison
                </button>
              )}
              {workspace.scoredResources && workspace.scoredResources.length > 0 && (
                <>
                  {onRescoreAll && (
                    <button
                      onClick={onRescoreAll}
                      disabled={scoring}
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        border: `1px solid ${PALETTE.teal}`,
                        borderRadius: 10,
                        background: PALETTE.tealBg,
                        color: PALETTE.teal,
                        fontWeight: 600,
                        cursor: scoring ? "not-allowed" : "pointer",
                        opacity: scoring ? 0.5 : 1,
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      Rescore All
                    </button>
                  )}
                  {onScoreAll && (
                    <button
                      onClick={onScoreAll}
                      disabled={scoring}
                      style={{
                        fontSize: 10,
                        padding: "2px 8px",
                        border: `1px solid ${PALETTE.sage}`,
                        borderRadius: 10,
                        background: PALETTE.sageBg,
                        color: PALETTE.sage,
                        fontWeight: 600,
                        cursor: scoring ? "not-allowed" : "pointer",
                        opacity: scoring ? 0.5 : 1,
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      Regenerate Facets
                    </button>
                  )}
                </>
              )}
              {onResearchAll && workspace.domains.some((d) => d.status === "not started") && (
                <button
                  onClick={onResearchAll}
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    border: `1px solid ${PALETTE.amber}`,
                    borderRadius: 10,
                    background: PALETTE.amberGlow,
                    color: PALETTE.amber,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  Research All
                </button>
              )}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {workspace.domains.map((d) => (
              <DomainCard
                key={d.name}
                domain={d}
                onClick={onDomainClick ? () => onDomainClick(d.name) : undefined}
                onScore={onScoreDomain ? () => onScoreDomain(d.name) : undefined}
                researching={researching?.has(d.name) || false}
                startTime={researchStartTimes?.get(d.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Plan */}
      {workspace.plan && (
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: PALETTE.inkMuted,
              marginBottom: 4,
            }}
          >
            Plan
          </div>
          <div
            className="planning-md"
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: PALETTE.ink,
              fontFamily: FONT_BODY,
            }}
            dangerouslySetInnerHTML={{ __html: marked.parse(workspace.plan) as string }}
          />
        </div>
      )}
      </>
      )}
    </div>
  );
}
