import { useState, useCallback } from "react";
import type { UserModel, ModelView } from "../types";
import { ModelViewComponent } from "./ModelView";
import { PALETTE, FONT_HEADING } from "../theme";

interface Props {
  t: number;
  menteeModel: UserModel;
  mentorModel: UserModel;
  previousMenteeModel?: UserModel;
  previousMentorModel?: UserModel;
  noteText?: string;
  noteLabel?: string;
  modelView: ModelView;
  isActive: boolean;
  isLatest: boolean;
  onProcess?: (noteText: string) => void;
  onRerunFrom?: (noteText: string) => void;
  processing?: boolean;
}

export function TimelineRow({
  t,
  menteeModel,
  mentorModel,
  previousMenteeModel,
  previousMentorModel,
  noteText,
  noteLabel,
  modelView,
  isActive,
  isLatest,
  onProcess,
  onRerunFrom,
  processing,
}: Props) {
  const [inputText, setInputText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const handleProcess = useCallback(() => {
    if (!inputText.trim() || processing) return;
    onProcess?.(inputText.trim());
    setInputText("");
  }, [inputText, processing, onProcess]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleProcess();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (editText.trim() && !processing) {
        onRerunFrom?.(editText.trim());
        setEditing(false);
      }
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      file.text().then((text) => setInputText(text));
    }
  }, []);

  const startEditing = () => {
    setEditText(noteText || "");
    setEditing(true);
  };

  return (
    <div
      style={{
        background: PALETTE.white,
        border: `1px solid ${isLatest ? PALETTE.teal : PALETTE.sand}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Row header */}
      <div
        style={{
          padding: "6px 16px",
          background: isLatest ? PALETTE.tealBg : PALETTE.parchment,
          borderBottom: `1px solid ${PALETTE.sand}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: FONT_HEADING,
            fontSize: 13,
            fontWeight: 700,
            color: PALETTE.ink,
          }}
        >
          t={t}
        </span>
        {noteLabel && (
          <span style={{ fontSize: 12, color: PALETTE.inkMuted }}>
            {noteLabel}
          </span>
        )}
        {onRerunFrom && !isActive && (
          <button
            onClick={() => editing ? setEditing(false) : startEditing()}
            disabled={processing}
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              border: `1px solid ${editing ? PALETTE.inkMuted : PALETTE.amber}`,
              borderRadius: 4,
              fontSize: 11,
              color: processing ? PALETTE.inkMuted : editing ? PALETTE.inkMuted : PALETTE.amber,
              background: "transparent",
              cursor: processing ? "default" : "pointer",
            }}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
        {isActive && (
          <span
            style={{
              fontSize: 11,
              color: PALETTE.teal,
              fontWeight: 600,
              marginLeft: "auto",
            }}
          >
            ACTIVE
          </span>
        )}
      </div>

      {/* 3-column content: Note (input) → Mentee model (output) → Mentor model (output) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 0,
          minHeight: 150,
        }}
      >
        {/* Note column (input) */}
        <div style={{ borderRight: `1px solid ${PALETTE.sand}`, padding: 12 }}>
          {isActive ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                gap: 8,
              }}
            >
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                style={{
                  flex: 1,
                  border: `2px ${dragOver ? "solid" : "dashed"} ${
                    dragOver ? PALETTE.teal : PALETTE.sand
                  }`,
                  borderRadius: 8,
                  display: "flex",
                }}
              >
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste a note here... (Cmd+Enter to process)"
                  disabled={processing}
                  style={{
                    flex: 1,
                    border: "none",
                    outline: "none",
                    resize: "none",
                    padding: 10,
                    fontSize: 14,
                    fontFamily: "'Source Sans 3', sans-serif",
                    background: "transparent",
                    color: PALETTE.ink,
                    lineHeight: 1.5,
                  }}
                />
              </div>
              <button
                onClick={handleProcess}
                disabled={!inputText.trim() || processing}
                style={{
                  padding: "7px 16px",
                  background:
                    inputText.trim() && !processing
                      ? PALETTE.amber
                      : PALETTE.sand,
                  color:
                    inputText.trim() && !processing
                      ? PALETTE.white
                      : PALETTE.inkMuted,
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    inputText.trim() && !processing ? "pointer" : "default",
                  alignSelf: "flex-start",
                }}
              >
                {processing ? "Processing..." : "Process Note"}
              </button>
            </div>
          ) : editing ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                gap: 8,
              }}
            >
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={handleEditKeyDown}
                disabled={processing}
                style={{
                  flex: 1,
                  border: `1px solid ${PALETTE.amber}`,
                  borderRadius: 8,
                  outline: "none",
                  resize: "none",
                  padding: 10,
                  fontSize: 13,
                  fontFamily: "'Source Sans 3', sans-serif",
                  background: PALETTE.amberGlow,
                  color: PALETTE.ink,
                  lineHeight: 1.6,
                  minHeight: 120,
                }}
              />
              <button
                onClick={() => {
                  if (editText.trim() && !processing) {
                    onRerunFrom?.(editText.trim());
                    setEditing(false);
                  }
                }}
                disabled={!editText.trim() || processing}
                style={{
                  padding: "7px 16px",
                  background:
                    editText.trim() && !processing
                      ? PALETTE.amber
                      : PALETTE.sand,
                  color:
                    editText.trim() && !processing
                      ? PALETTE.white
                      : PALETTE.inkMuted,
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    editText.trim() && !processing ? "pointer" : "default",
                  alignSelf: "flex-start",
                }}
              >
                {processing ? "Processing..." : "Rerun from here"}
              </button>
            </div>
          ) : (
            <div
              style={{
                fontSize: 13,
                color: PALETTE.inkLight,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {noteText || ""}
            </div>
          )}
        </div>

        {/* Mentee model (output) */}
        <div style={{ borderRight: `1px solid ${PALETTE.sand}`, padding: 0 }}>
          <ModelViewComponent
            model={menteeModel}
            view={modelView}
            label="mentee"
            previousModel={previousMenteeModel}
          />
        </div>

        {/* Mentor model (output) */}
        <div style={{ padding: 0 }}>
          <ModelViewComponent
            model={mentorModel}
            view={modelView}
            label="mentor"
            previousModel={previousMentorModel}
          />
        </div>
      </div>
    </div>
  );
}
