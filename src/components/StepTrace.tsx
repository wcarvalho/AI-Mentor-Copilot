import { useState } from "react";
import type { ProcessingStep } from "../types";
import { getEntryName } from "../update";
import { PALETTE } from "../theme";

interface Props {
  step: ProcessingStep;
  fromT: number;
}

function safe(s: unknown): string {
  return typeof s === "string" ? s : String(s ?? "");
}

function fmt(n: unknown): string {
  return typeof n === "number" ? n.toFixed(1) : "?";
}

// Generic delta summary: iterate over keys, detect add/update/remove arrays or scalar changes
function DeltaSummary({ delta, label }: { delta?: Record<string, unknown>; label: string }) {
  if (!delta) return null;

  const parts: string[] = [];
  try {
    for (const [key, value] of Object.entries(delta)) {
      if (key === "reasoning") continue;

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;

        // Array delta (has add/update/remove)
        if (Array.isArray(obj.add)) {
          for (const item of obj.add) {
            const name = getEntryName(item) || JSON.stringify(item).slice(0, 30);
            const conf = typeof (item as Record<string, unknown>)?.confidence === "number"
              ? `(${fmt((item as Record<string, unknown>).confidence)})`
              : "";
            parts.push(`+${key}:${safe(name).slice(0, 25)}${conf}`);
          }
        }
        if (Array.isArray(obj.update)) {
          for (const item of obj.update) {
            const name = getEntryName(item) || "?";
            parts.push(`~${key}:${safe(name).slice(0, 25)}`);
          }
        }
        if (Array.isArray(obj.remove)) {
          for (const item of obj.remove) {
            parts.push(`-${key}:${safe(item).slice(0, 25)}`);
          }
        }

        // Object with description (like old worldModel)
        if (!("add" in obj) && !("update" in obj) && !("remove" in obj)) {
          if (obj.description || obj.confidence !== undefined) {
            parts.push(`~${key}`);
          }
        }
      } else if (typeof value === "string") {
        parts.push(`~${key}`);
      }
    }
  } catch (e) {
    parts.push(`[render error: ${e}]`);
  }

  if (!parts.length) parts.push("no changes");

  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: PALETTE.inkMuted }}>
        {label}:
      </span>{" "}
      <span style={{ fontSize: 12, color: PALETTE.ink, fontFamily: "monospace" }}>
        {parts.join("  ")}
      </span>
    </div>
  );
}

function Expandable({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          padding: "2px 0",
          fontSize: 12,
          color: PALETTE.teal,
          cursor: "pointer",
          fontFamily: "'Source Sans 3', sans-serif",
        }}
      >
        {open ? "v" : ">"} {title}
      </button>
      {open && (
        <pre
          style={{
            background: PALETTE.parchment,
            padding: 10,
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            overflow: "auto",
            maxHeight: 300,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {children}
        </pre>
      )}
    </div>
  );
}

function PredictionBadge({ score }: { score: number }) {
  const color = score >= 0.7 ? PALETTE.sage : score >= 0.4 ? PALETTE.amber : PALETTE.rose;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 10,
        background: color,
        color: PALETTE.white,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {score.toFixed(2)}
    </span>
  );
}

export function StepTrace({ step, fromT }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        margin: "0 20px",
        borderLeft: `2px solid ${PALETTE.sand}`,
        marginLeft: 40,
        paddingLeft: 16,
        paddingTop: 4,
        paddingBottom: 4,
      }}
    >
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          padding: "4px 0",
          fontSize: 12,
          color: PALETTE.inkMuted,
          cursor: "pointer",
          fontFamily: "'Source Sans 3', sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{expanded ? "v" : ">"}</span>
        <span>t={fromT} → t={fromT + 1}</span>
        {step.prediction && <PredictionBadge score={step.prediction.score} />}
        <span style={{ color: PALETTE.inkMuted }}>{(step.durationMs / 1000).toFixed(0)}s</span>
        {(step.updateModelUsed || step.scoringModelUsed) && (
          <span style={{ color: PALETTE.inkMuted, fontSize: 11 }}>
            [{step.updateModelUsed || "?"}/{step.scoringModelUsed || "?"}]
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ paddingTop: 8, paddingBottom: 4 }}>
          {/* Prediction */}
          {step.prediction && (
            <div
              style={{
                marginBottom: 8,
                padding: 8,
                background: PALETTE.parchment,
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div style={{ marginBottom: 4 }}>
                <strong>Q:</strong> {step.prediction.question}
              </div>
              <div style={{ marginBottom: 4 }}>
                <strong>Predicted:</strong> {step.prediction.predicted}
              </div>
              <div style={{ color: PALETTE.inkMuted, fontStyle: "italic" }}>
                {step.prediction.reasoning}
              </div>
            </div>
          )}

          {/* Deltas */}
          <DeltaSummary delta={step.menteeDelta} label="Mentee" />
          {typeof step.menteeDelta?.reasoning === "string" && (
            <div style={{ fontSize: 11, color: PALETTE.inkLight, fontStyle: "italic", marginBottom: 6, paddingLeft: 12 }}>
              {step.menteeDelta.reasoning}
            </div>
          )}
          <DeltaSummary delta={step.mentorDelta} label="Mentor" />
          {typeof step.mentorDelta?.reasoning === "string" && (
            <div style={{ fontSize: 11, color: PALETTE.inkLight, fontStyle: "italic", marginBottom: 6, paddingLeft: 12 }}>
              {step.mentorDelta.reasoning}
            </div>
          )}

          {/* Expandable prompts/responses */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            <Expandable title="Mentee Prompt">{step.menteePrompt}</Expandable>
            <Expandable title="Mentee Response">{step.menteeRawResponse}</Expandable>
            <Expandable title="Mentor Prompt">{step.mentorPrompt}</Expandable>
            <Expandable title="Mentor Response">{step.mentorRawResponse}</Expandable>
          </div>
        </div>
      )}
    </div>
  );
}
