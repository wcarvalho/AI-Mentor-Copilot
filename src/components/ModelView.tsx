import { useState } from "react";
import type { UserModel, ModelView as ModelViewType } from "../types";
import { getEntryName } from "../update";
import { PALETTE, FONT_HEADING, SECTION_COLOR_PALETTE, SECTION_COLORS } from "../theme";

interface Props {
  model: UserModel;
  view: ModelViewType;
  label: string;
  showEvidence?: boolean;
  previousModel?: UserModel;
}

type DiffStatus = "new" | "updated" | "unchanged";

// Detect if a value is a list of objects with confidence (renderable as a bar list)
function isConfidenceList(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) => typeof item === "object" && item !== null && "confidence" in item
  );
}

// Detect if a value is an object with description + confidence (prose-with-confidence)
function isProseWithConfidence(value: unknown): value is { description: string; confidence: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.description === "string" && typeof obj.confidence === "number";
}

// Detect if a value is a people list (array of {name, relationship, situation?, innerModel?})
function isPeopleList(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).name === "string" &&
      (Array.isArray((item as Record<string, unknown>).situation) ||
        Array.isArray((item as Record<string, unknown>).innerModel))
  );
}

// Compute diff for a confidence list
function computeListDiff(
  current: Record<string, unknown>[],
  previous?: Record<string, unknown>[]
): Map<string, { status: DiffStatus; prevConfidence?: number }> {
  const map = new Map<string, { status: DiffStatus; prevConfidence?: number }>();
  if (!previous) return map;

  const prevByName = new Map<string, number>();
  for (const item of previous) {
    const name = getEntryName(item);
    if (name) prevByName.set(name.toLowerCase(), (item.confidence as number) || 0);
  }

  for (const item of current) {
    const name = getEntryName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    const conf = (item.confidence as number) || 0;
    if (!prevByName.has(key)) {
      map.set(key, { status: "new" });
    } else if (prevByName.get(key) !== conf) {
      map.set(key, { status: "updated", prevConfidence: prevByName.get(key) });
    } else {
      map.set(key, { status: "unchanged" });
    }
  }
  return map;
}

function diffStyle(status: DiffStatus): React.CSSProperties {
  if (status === "new") return { borderLeft: `3px solid ${PALETTE.teal}`, paddingLeft: 8, fontWeight: 600 };
  if (status === "updated") return { borderLeft: `3px solid ${PALETTE.amber}`, paddingLeft: 8 };
  return {};
}

function ConfidenceBar({ value }: { value: number }) {
  const v = typeof value === "number" ? value : 0;
  return (
    <div
      style={{
        width: 60,
        height: 8,
        background: PALETTE.sand,
        borderRadius: 4,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${v * 100}%`,
          height: "100%",
          background: PALETTE.teal,
          borderRadius: 4,
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

function EvidenceToggle({
  evidence,
  open,
  onToggle,
}: {
  evidence: string[];
  open: boolean;
  onToggle: () => void;
}) {
  if (!evidence?.length) return null;
  return (
    <span
      onClick={onToggle}
      style={{
        fontSize: 12,
        color: PALETTE.inkMuted,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {open ? "▼" : "▶"} ({evidence.length})
    </span>
  );
}

function EvidenceQuotes({ evidence }: { evidence: string[] }) {
  return (
    <div style={{ paddingLeft: 12, marginTop: 2, marginBottom: 2 }}>
      {evidence.map((e, i) => (
        <div
          key={i}
          style={{
            fontSize: 12,
            color: PALETTE.inkLight,
            fontStyle: "italic",
            marginBottom: 2,
            lineHeight: 1.4,
          }}
        >
          &ldquo;{e}&rdquo;
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  children,
  color,
}: {
  title: string;
  children: React.ReactNode;
  color?: string;
}) {
  const textColor = color || PALETTE.ink;
  return (
    <div style={{ color: textColor }}>
      <h3
        style={{
          fontFamily: FONT_HEADING,
          fontSize: 11,
          color: textColor,
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: 1,
          opacity: 0.7,
        }}
      >
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

// Render a confidence list (values, beliefs, goals, or any array of {name, confidence, evidence?})
function ConfidenceListSection({
  title,
  items,
  color,
  showEvidence,
  diff,
}: {
  title: string;
  items: Record<string, unknown>[];
  color: string;
  showEvidence: boolean;
  diff: Map<string, { status: DiffStatus; prevConfidence?: number }>;
}) {
  const sorted = [...items].sort(
    (a, b) => ((b.confidence as number) || 0) - ((a.confidence as number) || 0)
  );
  const [openEvidence, setOpenEvidence] = useState<Set<number>>(new Set());

  return (
    <Section title={title} color={color}>
      {sorted.map((item, i) => {
        const name = getEntryName(item) || `item ${i}`;
        const confidence = (item.confidence as number) || 0;
        const evidence = Array.isArray(item.evidence) ? (item.evidence as string[]) : [];
        const d = diff.get(name.toLowerCase());
        const status = d?.status || "unchanged";
        const nameKey = Object.keys(item).find(
          (k) => typeof item[k] === "string" && k !== "confidence" && k !== "reasoning"
        );
        const isBeliefLike = nameKey === "belief";
        const isOpen = openEvidence.has(i);

        return (
          <div key={i} style={diffStyle(status)}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span style={{ flex: 1, fontStyle: isBeliefLike ? "italic" : "normal" }}>
                {showEvidence && (
                  <EvidenceToggle
                    evidence={evidence}
                    open={isOpen}
                    onToggle={() => {
                      setOpenEvidence((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      });
                    }}
                  />
                )}
                {showEvidence && evidence.length > 0 && " "}
                {isBeliefLike ? `"${name}"` : name}
              </span>
              <ConfidenceBar value={confidence} />
              <span style={{ fontSize: 12, color: PALETTE.inkMuted, width: 44 }}>
                {status === "updated" && d?.prevConfidence != null
                  ? `${d.prevConfidence.toFixed(1)}\u2192${confidence.toFixed(1)}`
                  : typeof confidence === "number" ? confidence.toFixed(1) : "?"}
              </span>
            </div>
            {showEvidence && isOpen && evidence.length > 0 && (
              <EvidenceQuotes evidence={evidence} />
            )}
          </div>
        );
      })}
    </Section>
  );
}

// Render a people list (social model: important people with situation + innerModel)
function PeopleSection({
  items,
  color,
  showEvidence,
}: {
  items: Record<string, unknown>[];
  color: string;
  showEvidence: boolean;
}) {
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());

  const toggleEvidence = (key: string) => {
    setOpenEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderClaim = (
    item: Record<string, unknown>,
    idx: number,
    isInnerModel: boolean,
    personIdx: number,
    sectionKey: string
  ) => {
    const claim = (item.claim as string) || `item ${idx}`;
    const confidence = (item.confidence as number) || 0;
    const evidence = Array.isArray(item.evidence) ? (item.evidence as string[]) : [];
    const evKey = `${personIdx}-${sectionKey}-${idx}`;
    const isOpen = openEvidence.has(evKey);

    return (
      <div key={idx}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 2,
          }}
        >
          <span style={{ flex: 1, fontStyle: isInnerModel ? "italic" : "normal" }}>
            {showEvidence && (
              <EvidenceToggle
                evidence={evidence}
                open={isOpen}
                onToggle={() => toggleEvidence(evKey)}
              />
            )}
            {showEvidence && evidence.length > 0 && " "}
            {isInnerModel ? `🧠 "${claim}"` : claim}
          </span>
          <ConfidenceBar value={confidence} />
          <span style={{ fontSize: 12, color: PALETTE.inkMuted, width: 44 }}>
            {confidence.toFixed(1)}
          </span>
        </div>
        {showEvidence && isOpen && evidence.length > 0 && (
          <EvidenceQuotes evidence={evidence} />
        )}
      </div>
    );
  };

  return (
    <Section title="People" color={color}>
      {items.map((person, pi) => {
        const name = (person.name as string) || "Unknown";
        const relationship = (person.relationship as string) || "";
        const situation = Array.isArray(person.situation)
          ? (person.situation as Record<string, unknown>[])
          : [];
        const innerModel = Array.isArray(person.innerModel)
          ? (person.innerModel as Record<string, unknown>[])
          : [];

        return (
          <div key={pi} style={{ marginBottom: pi < items.length - 1 ? 8 : 0 }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{name}</span>
              {relationship && (
                <span style={{ color: PALETTE.inkMuted, fontSize: 12, marginLeft: 6 }}>
                  {relationship}
                </span>
              )}
            </div>
            {situation.map((item, i) => renderClaim(item, i, false, pi, "sit"))}
            {innerModel.map((item, i) => renderClaim(item, i, true, pi, "im"))}
          </div>
        );
      })}
    </Section>
  );
}

function FieldsView({
  model,
  showEvidence = true,
  previousModel,
}: {
  model: UserModel;
  showEvidence?: boolean;
  previousModel?: UserModel;
}) {
  const entries = Object.entries(model);
  const isEmpty = entries.length === 0 || entries.every(([, v]) => {
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "string") return !v;
    if (typeof v === "object" && v !== null && "description" in v) return !(v as Record<string, unknown>).description;
    return false;
  });

  if (isEmpty) {
    return (
      <div style={{ color: PALETTE.inkMuted, fontStyle: "italic", padding: 20 }}>
        Empty model. Process a note to populate.
      </div>
    );
  }

  let colorIdx = 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
      {entries.map(([key, value]) => {
        const color = SECTION_COLOR_PALETTE[colorIdx % SECTION_COLOR_PALETTE.length];
        colorIdx++;
        const title = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

        if (isPeopleList(value)) {
          return (
            <PeopleSection
              key={key}
              items={value}
              color={SECTION_COLORS.people || color}
              showEvidence={showEvidence}
            />
          );
        }

        if (isConfidenceList(value)) {
          const prevList = previousModel && Array.isArray(previousModel[key])
            ? (previousModel[key] as Record<string, unknown>[])
            : undefined;
          const diff = computeListDiff(value, prevList);
          return (
            <ConfidenceListSection
              key={key}
              title={title}
              items={value}
              color={color}
              showEvidence={showEvidence}
              diff={diff}
            />
          );
        }

        if (isProseWithConfidence(value)) {
          if (!value.description) return null;
          const prevVal = previousModel?.[key];
          let status: DiffStatus = "unchanged";
          if (!prevVal || !(prevVal as Record<string, unknown>).description) {
            status = value.description ? "new" : "unchanged";
          } else if (
            isProseWithConfidence(prevVal) &&
            (prevVal.description !== value.description || prevVal.confidence !== value.confidence)
          ) {
            status = "updated";
          }
          return (
            <Section key={key} title={title} color={color}>
              <div style={{ ...diffStyle(status), display: "flex", alignItems: "start", gap: 8 }}>
                <span style={{ flex: 1 }}>{value.description}</span>
                <ConfidenceBar value={value.confidence} />
                <span style={{ fontSize: 12, color: PALETTE.inkMuted, width: 28 }}>
                  {value.confidence.toFixed(1)}
                </span>
              </div>
            </Section>
          );
        }

        if (typeof value === "string" && value) {
          return (
            <Section key={key} title={title} color={color}>
              <div style={{ lineHeight: 1.6 }}>{value}</div>
            </Section>
          );
        }

        // Unknown shape — render as JSON
        if (value !== null && value !== undefined && value !== "") {
          return (
            <Section key={key} title={title} color={color}>
              <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace" }}>
                {JSON.stringify(value, null, 2)}
              </pre>
            </Section>
          );
        }

        return null;
      })}
    </div>
  );
}

function ProseView({ model }: { model: UserModel }) {
  const summary = typeof model.summary === "string" ? model.summary : "";
  if (!summary) {
    return (
      <div style={{ color: PALETTE.inkMuted, fontStyle: "italic", padding: 20 }}>
        No summary yet. Process a note to generate one.
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: FONT_HEADING,
        fontSize: 13,
        lineHeight: 1.6,
        color: PALETTE.ink,
        padding: "8px 0",
      }}
    >
      {summary}
    </div>
  );
}

export function ModelViewComponent({ model, view, label, showEvidence = true, previousModel }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div
      style={{
        background: PALETTE.white,
        border: `1px solid ${PALETTE.sand}`,
        borderRadius: 12,
        padding: 16,
        height: "100%",
        overflow: "auto",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          color: PALETTE.inkMuted,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {label}
        <button
          onClick={() => setShowRaw(!showRaw)}
          style={{
            fontSize: 10,
            padding: "2px 6px",
            border: `1px solid ${showRaw ? PALETTE.teal : PALETTE.sand}`,
            borderRadius: 4,
            background: showRaw ? PALETTE.tealBg : "transparent",
            color: showRaw ? PALETTE.teal : PALETTE.inkMuted,
            cursor: "pointer",
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          Raw
        </button>
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
          {JSON.stringify(model, null, 2)}
        </pre>
      ) : view === "fields" ? (
        <FieldsView model={model} showEvidence={showEvidence} previousModel={previousModel} />
      ) : (
        <ProseView model={model} />
      )}
    </div>
  );
}
