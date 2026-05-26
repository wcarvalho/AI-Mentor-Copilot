import { useState } from "react";
import {
  DEFAULT_PROMPTS,
  savePrompt,
  resetPrompt,
  isPromptModified,
} from "../prompts";
import { PALETTE } from "../theme";

interface Props {
  prompts: Record<string, string>;
  onUpdate: (prompts: Record<string, string>) => void;
}

// Derive prompt keys directly from DEFAULT_PROMPTS so new prompts appear automatically
const PROMPT_KEYS = Object.keys(DEFAULT_PROMPTS);
const camelToTitle = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();

export function PromptEditor({ prompts, onUpdate }: Props) {
  const [selected, setSelected] = useState("deltaUpdate");

  const handleSave = (value: string) => {
    savePrompt(selected, value);
    onUpdate({ ...prompts, [selected]: value });
  };

  const handleReset = () => {
    resetPrompt(selected);
    onUpdate({ ...prompts, [selected]: DEFAULT_PROMPTS[selected] });
  };

  // Removed: the collapsed state. SessionBar handles show/hide now.
  if (false) {
    return (
      <button
        style={{
          background: "none",
          border: `1px solid ${PALETTE.sand}`,
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: 14,
          color: PALETTE.teal,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        Strategy Prompts (click to edit)
      </button>
    );
  }

  return (
    <div
      style={{
        background: PALETTE.white,
        border: `1px solid ${PALETTE.sand}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: `1px solid ${PALETTE.sand}`,
            fontSize: 14,
            background: PALETTE.white,
            color: PALETTE.ink,
          }}
        >
          {PROMPT_KEYS.map((key) => (
            <option key={key} value={key}>
              {camelToTitle(key)}
              {isPromptModified(key) ? " *" : ""}
            </option>
          ))}
        </select>

        <button
          onClick={handleReset}
          style={{
            padding: "6px 12px",
            background: "transparent",
            color: PALETTE.inkMuted,
            border: `1px solid ${PALETTE.sand}`,
            borderRadius: 6,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Reset
        </button>

        {/* Collapse handled by parent SessionBar */}
      </div>

      <textarea
        value={prompts[selected] ?? DEFAULT_PROMPTS[selected] ?? ""}
        onChange={(e) => handleSave(e.target.value)}
        style={{
          width: "100%",
          height: 300,
          border: `1px solid ${PALETTE.sand}`,
          borderRadius: 8,
          padding: 12,
          fontSize: 13,
          fontFamily: "monospace",
          lineHeight: 1.5,
          resize: "vertical",
          color: PALETTE.ink,
          background: PALETTE.parchment,
        }}
      />

      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: PALETTE.inkMuted,
        }}
      >
        Variables: {"{model}"}, {"{note}"}, {"{target}"}, {"{question}"},
        {" {predicted}"}, {"{actual}"}, {"{menteeModel}"}, {"{mentorModel}"},
        {" {workspace}"}, {"{domain}"}, {"{constraints}"}, {"{goal}"}
      </div>
    </div>
  );
}
