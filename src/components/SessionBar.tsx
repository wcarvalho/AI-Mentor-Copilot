import { useState, useEffect, useRef } from "react";
import type { UpdateMode, ModelView, BatchNote } from "../types";
import { PromptEditor } from "./PromptEditor";
import { PALETTE, FONT_HEADING } from "../theme";

export interface ModelSettings {
  updateModel: string;
  scoringModel: string;
  chatModel: string;
  thinking: boolean;
  scoring: boolean;
}

interface Props {
  mode: UpdateMode;
  onModeChange: (m: UpdateMode) => void;
  modelView: ModelView;
  onViewChange: (v: ModelView) => void;
  prompts: Record<string, string>;
  onPromptsUpdate: (p: Record<string, string>) => void;
  modelSettings: ModelSettings;
  onModelSettingsChange: (s: ModelSettings) => void;
  sessionName: string;
  onSessionNameChange: (name: string) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onLoad: (sessionName: string) => void;
  onDelete: (sessionName: string) => void;
  onLoadTest: (notes: BatchNote[]) => void;
  onRerun: () => void;
  onReset: () => void;
  processing: boolean;
  hasSteps: boolean;
  avgPrediction: { avg: number; count: number } | null;
}

const MODEL_OPTIONS = ["opus", "sonnet", "haiku"];

export function SessionBar({
  mode,
  onModeChange,
  modelView,
  onViewChange,
  prompts,
  onPromptsUpdate,
  modelSettings,
  onModelSettingsChange,
  sessionName,
  onSessionNameChange,
  onSave,
  onDuplicate,
  onLoad,
  onDelete,
  onLoadTest,
  onRerun,
  onReset,
  processing,
  hasSteps,
  avgPrediction,
}: Props) {
  const [sessions, setSessions] = useState<string[]>([]);
  const [testFolders, setTestFolders] = useState<string[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showPrompts, setShowPrompts] = useState(true);
  const sessionsRef = useRef<HTMLDivElement>(null);

  const refreshSessions = () => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []))
      .catch(() => {});
  };

  useEffect(() => {
    refreshSessions();
    fetch("/api/tests")
      .then((r) => r.json())
      .then((d) => setTestFolders(d.folders || []))
      .catch(() => {});
  }, []);

  // Close sessions dropdown on click outside
  useEffect(() => {
    if (!showSessions) return;
    const handler = (e: MouseEvent) => {
      if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) {
        setShowSessions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSessions]);

  const handleDeleteSession = async (name: string) => {
    try {
      await fetch(`/api/sessions/${name}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s !== name));
      onDelete(name);
    } catch {
      // silent
    }
  };

  const handleLoadTest = async (name: string) => {
    const res = await fetch(`/api/tests/${name}`);
    const data = await res.json();
    if (data.notes?.length) onLoadTest(data.notes);
  };

  const selectStyle = {
    padding: "4px 8px",
    background: PALETTE.white,
    border: `1px solid ${PALETTE.sand}`,
    borderRadius: 4,
    fontSize: 12,
    color: PALETTE.ink,
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: PALETTE.white,
        borderBottom: `1px solid ${PALETTE.sand}`,
      }}
    >
      {/* Top row: title + controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 20px",
          flexWrap: "wrap",
        }}
      >
        <h1
          style={{
            fontFamily: FONT_HEADING,
            fontSize: 16,
            color: PALETTE.ink,
            margin: 0,
          }}
        >
          User Model Lab
        </h1>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 2 }}>
          {(["delta", "full"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              style={{
                padding: "3px 10px",
                border: `1px solid ${mode === m ? PALETTE.amber : PALETTE.sand}`,
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
                background: mode === m ? PALETTE.amberGlow : "transparent",
                color: mode === m ? PALETTE.amber : PALETTE.inkMuted,
              }}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* View toggle */}
        <div style={{ display: "flex", gap: 2 }}>
          {(["fields", "prose"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              style={{
                padding: "3px 10px",
                border: "none",
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
                background: modelView === v ? PALETTE.parchment : "transparent",
                color: modelView === v ? PALETTE.ink : PALETTE.inkMuted,
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        {/* Model selection */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: PALETTE.inkMuted }}>Update:</span>
          <select
            value={modelSettings.updateModel}
            onChange={(e) =>
              onModelSettingsChange({ ...modelSettings, updateModel: e.target.value })
            }
            style={selectStyle}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: PALETTE.inkMuted }}>Scoring:</span>
          <select
            value={modelSettings.scoringModel}
            onChange={(e) =>
              onModelSettingsChange({ ...modelSettings, scoringModel: e.target.value })
            }
            style={selectStyle}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: PALETTE.inkMuted }}>Chat:</span>
          <select
            value={modelSettings.chatModel}
            onChange={(e) =>
              onModelSettingsChange({ ...modelSettings, chatModel: e.target.value })
            }
            style={selectStyle}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Thinking toggle */}
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
            checked={modelSettings.thinking}
            onChange={(e) =>
              onModelSettingsChange({ ...modelSettings, thinking: e.target.checked })
            }
            style={{ margin: 0 }}
          />
          Thinking
        </label>

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
            checked={modelSettings.scoring}
            onChange={(e) =>
              onModelSettingsChange({ ...modelSettings, scoring: e.target.checked })
            }
            style={{ margin: 0 }}
          />
          Scoring
        </label>

        {/* Load test folder */}
        {testFolders.length > 0 && (
          <select
            onChange={(e) => {
              if (e.target.value) handleLoadTest(e.target.value);
              e.target.value = "";
            }}
            disabled={processing}
            style={selectStyle}
          >
            <option value="">Load Test...</option>
            {testFolders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}

        {/* Load session */}
        {sessions.length > 0 && (
          <div ref={sessionsRef} style={{ position: "relative" }}>
            <button
              onClick={() => { setShowSessions(!showSessions); refreshSessions(); }}
              disabled={processing}
              style={{
                ...selectStyle,
                cursor: processing ? "default" : "pointer",
                background: PALETTE.white,
              }}
            >
              Sessions ({sessions.length})
            </button>
            {showSessions && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  background: PALETTE.white,
                  border: `1px solid ${PALETTE.sand}`,
                  borderRadius: 8,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  zIndex: 200,
                  minWidth: 260,
                  maxHeight: 300,
                  overflow: "auto",
                }}
              >
                {sessions.map((s) => (
                  <div
                    key={s}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      borderBottom: `1px solid ${PALETTE.parchment}`,
                      fontSize: 12,
                    }}
                  >
                    <button
                      onClick={() => {
                        onLoad(s);
                        setShowSessions(false);
                      }}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        fontSize: 12,
                        color: PALETTE.ink,
                        cursor: "pointer",
                        padding: "2px 0",
                      }}
                    >
                      {s.replace(".json", "")}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s);
                      }}
                      title="Delete session"
                      style={{
                        background: "none",
                        border: "none",
                        color: PALETTE.inkMuted,
                        cursor: "pointer",
                        fontSize: 14,
                        padding: "2px 4px",
                        lineHeight: 1,
                      }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={onSave}
            disabled={processing}
            style={{
              padding: "3px 10px",
              border: `1px solid ${PALETTE.sage}`,
              borderRadius: 4,
              fontSize: 12,
              color: PALETTE.sage,
              background: "transparent",
              cursor: processing ? "default" : "pointer",
            }}
          >
            Save
          </button>
          <button
            onClick={onDuplicate}
            disabled={processing || !hasSteps}
            title="Duplicate session — creates a copy you can save with a new name"
            style={{
              padding: "3px 10px",
              border: `1px solid ${PALETTE.inkMuted}`,
              borderRadius: 4,
              fontSize: 12,
              color: !hasSteps ? PALETTE.inkMuted : PALETTE.ink,
              background: "transparent",
              cursor: processing || !hasSteps ? "default" : "pointer",
            }}
          >
            Dup
          </button>
          <button
            onClick={onRerun}
            disabled={processing || !hasSteps}
            title="Re-process same notes with current model settings"
            style={{
              padding: "3px 10px",
              border: `1px solid ${PALETTE.amber}`,
              borderRadius: 4,
              fontSize: 12,
              color: !hasSteps ? PALETTE.inkMuted : PALETTE.amber,
              background: "transparent",
              cursor: processing || !hasSteps ? "default" : "pointer",
            }}
          >
            Rerun
          </button>
          <button
            onClick={onReset}
            disabled={processing}
            style={{
              padding: "3px 10px",
              border: `1px solid ${PALETTE.rose}`,
              borderRadius: 4,
              fontSize: 12,
              color: PALETTE.rose,
              background: "transparent",
              cursor: processing ? "default" : "pointer",
            }}
          >
            New
          </button>
        </div>
      </div>

      {/* Session name row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 20px 8px",
        }}
      >
        <input
          type="text"
          value={sessionName}
          onChange={(e) => onSessionNameChange(e.target.value)}
          placeholder="session name..."
          style={{
            flex: 1,
            padding: "4px 10px",
            border: `1px solid ${PALETTE.sand}`,
            borderRadius: 4,
            fontSize: 13,
            color: PALETTE.ink,
            background: PALETTE.parchment,
            outline: "none",
            fontFamily: FONT_HEADING,
          }}
        />
        {avgPrediction && (
          <span style={{ fontSize: 12, color: PALETTE.inkMuted, whiteSpace: "nowrap" }}>
            avg prediction: {avgPrediction.avg.toFixed(2)} ({avgPrediction.count} notes)
          </span>
        )}
      </div>

      {/* Prompts editor — collapsible */}
      <div style={{ padding: "0 20px 10px" }}>
        <button
          onClick={() => setShowPrompts(!showPrompts)}
          style={{
            background: "none",
            border: "none",
            fontSize: 12,
            color: PALETTE.teal,
            cursor: "pointer",
            padding: "4px 0",
            fontFamily: FONT_HEADING,
          }}
        >
          {showPrompts ? "Hide" : "Show"} Prompts
        </button>
        {showPrompts && <PromptEditor prompts={prompts} onUpdate={onPromptsUpdate} />}
      </div>
    </div>
  );
}
