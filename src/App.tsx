import { useState, useCallback, useEffect, useRef } from "react";
import type {
  UserModel,
  ProcessingStep,
  UpdateMode,
  ModelView,
  BatchNote,
} from "./types";
import { EMPTY_MODEL } from "./types";
import { loadPrompts } from "./prompts";
import { processNote, processBatch } from "./update";
import { SessionBar, type ModelSettings } from "./components/SessionBar";
import { TimelineRow } from "./components/TimelineRow";
import { StepTrace } from "./components/StepTrace";
import { PlanningTab } from "./components/PlanningTab";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PALETTE, FONT_BODY, FONT_HEADING } from "./theme";

type Tab = "update" | "planning";

export function App() {
  const [tab, setTab] = useState<Tab>("update");
  const [steps, setSteps] = useState<ProcessingStep[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [savedAsFile, setSavedAsFile] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [mode, setMode] = useState<UpdateMode>("delta");
  const [modelView, setModelView] = useState<ModelView>("fields");
  const [prompts, setPrompts] = useState(loadPrompts);
  const [modelSettings, setModelSettings] = useState<ModelSettings>({
    updateModel: "opus",
    scoringModel: "sonnet",
    chatModel: "opus",
    thinking: false,
    scoring: true,
  });

  const [focusMode, setFocusMode] = useState(false);

  // Toggle focus mode with Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) setFocusMode(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusMode]);

  // URL param for initial tab from query string
  const [initialUrlSession] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    if (urlTab === "planning") return { session: params.get("session"), tab: "planning" as Tab };
    return { session: params.get("session"), tab: (urlTab as Tab) || "update" as Tab };
  });

  // Apply initial tab from URL
  useEffect(() => {
    if (initialUrlSession.tab !== "update") setTab(initialUrlSession.tab);
  }, [initialUrlSession.tab]);

  // Derived: current models are from the last step, or empty
  const currentMentee = steps.length
    ? steps[steps.length - 1].menteeModelAfter
    : JSON.parse(JSON.stringify(EMPTY_MODEL));
  const currentMentor = steps.length
    ? steps[steps.length - 1].mentorModelAfter
    : JSON.parse(JSON.stringify(EMPTY_MODEL));

  // Process a single note (from the active row)
  const handleProcess = useCallback(
    async (noteText: string) => {
      setProcessing(true);
      setError(null);
      try {
        const step = await processNote({
          noteText,
          noteIndex: steps.length,
          menteeModel: currentMentee,
          mentorModel: currentMentor,
          mode,
          prompts,
          skipPrediction:
            !modelSettings.scoring ||
            steps.length === 0 ||
            Object.keys(currentMentee).length === 0,
          updateModel: modelSettings.updateModel,
          scoringModel: modelSettings.scoringModel,
        });
        setSteps((prev) => [...prev, step]);
      } catch (err) {
        console.error("Process error:", err);
        setError(String(err));
      } finally {
        setProcessing(false);
      }
    },
    [currentMentee, currentMentor, mode, prompts, steps.length, modelSettings]
  );

  // Process a batch
  const handleBatch = useCallback(
    async (notes: BatchNote[]) => {
      setProcessing(true);
      setError(null);
      setSteps([]);
      try {
        await processBatch(
          notes,
          mode,
          prompts,
          (step) => {
            setSteps((prev) => [...prev, step]);
          },
          modelSettings.updateModel,
          modelSettings.scoringModel,
          !modelSettings.scoring
        );
      } catch (err) {
        console.error("Batch error:", err);
        setError(String(err));
      } finally {
        setProcessing(false);
      }
    },
    [mode, prompts, modelSettings]
  );

  // Rerun from a specific step (with possibly edited note text)
  const handleRerunFrom = useCallback(
    async (fromIndex: number, editedNoteText: string) => {
      setProcessing(true);
      setError(null);
      try {
        // Collect notes: edited text for fromIndex, original for the rest
        const notes: BatchNote[] = [
          { text: editedNoteText, label: steps[fromIndex]?.noteLabel },
          ...steps.slice(fromIndex + 1).map((s) => ({ text: s.noteText, label: s.noteLabel })),
        ];

        // Starting models from step before fromIndex
        let menteeModel = fromIndex > 0
          ? JSON.parse(JSON.stringify(steps[fromIndex - 1].menteeModelAfter))
          : JSON.parse(JSON.stringify(EMPTY_MODEL));
        let mentorModel = fromIndex > 0
          ? JSON.parse(JSON.stringify(steps[fromIndex - 1].mentorModelAfter))
          : JSON.parse(JSON.stringify(EMPTY_MODEL));

        // Keep steps before fromIndex
        const kept = steps.slice(0, fromIndex);
        setSteps(kept);

        // Process each note sequentially
        for (let i = 0; i < notes.length; i++) {
          const step = await processNote({
            noteText: notes[i].text,
            noteIndex: fromIndex + i,
            noteLabel: notes[i].label,
            menteeModel,
            mentorModel,
            mode,
            prompts,
            skipPrediction: !modelSettings.scoring || fromIndex + i === 0,
            updateModel: modelSettings.updateModel,
            scoringModel: modelSettings.scoringModel,
          });
          menteeModel = step.menteeModelAfter;
          mentorModel = step.mentorModelAfter;
          setSteps((prev) => [...prev, step]);
        }
      } catch (err) {
        console.error("Rerun error:", err);
        setError(String(err));
      } finally {
        setProcessing(false);
      }
    },
    [steps, mode, prompts, modelSettings]
  );

  // Planning chats are stored server-side in sessions/planning/
  const collectPlanningChats = () => ({});

  // Save session
  const handleSave = async () => {
    const name = sessionName.trim() || `session-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
    if (!sessionName.trim()) setSessionName(name);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          createdAt: Date.now(),
          mode,
          modelSettings,
          steps,
          prompts,
          planningChats: collectPlanningChats(),
        }),
      });
      const data = await res.json();
      if (data.saved) {
        const newName = data.saved.replace(".json", "");
        const oldName = sessionName || "unsaved";
        // If name changed from what was loaded/saved, delete the old file (rename)
        if (savedAsFile && savedAsFile !== data.saved) {
          fetch(`/api/sessions/${savedAsFile}`, { method: "DELETE" }).catch(() => {});
        }
        // Rename planning chat files on server to match new session name
        if (oldName !== newName) {
          fetch("/api/planning/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldPrefix: `planning-chat-${oldName}-`,
              newPrefix: `planning-chat-${newName}-`,
            }),
          }).catch(() => {});
        }
        setError(null);
        setSavedAsFile(data.saved);
        setSessionName(newName);
      }
    } catch (err) {
      setError(`Save failed: ${err}`);
    }
  };

  // Load session
  const handleLoad = async (fileName: string) => {
    try {
      const res = await fetch(`/api/sessions/${fileName}`);
      const data = await res.json();
      if (data.steps) {
        setSteps(data.steps);
        if (data.mode) setMode(data.mode);
        if (data.modelSettings) setModelSettings(data.modelSettings);
        if (data.prompts) setPrompts(data.prompts);
        setSessionName(fileName.replace(".json", ""));
        setSavedAsFile(fileName);
        setSessionVersion((v) => v + 1);

        // Restore planning chats from session file to server
        if (data.planningChats) {
          const loadedName = fileName.replace(".json", "");
          for (const [savedKey, value] of Object.entries(data.planningChats)) {
            const tMatch = savedKey.match(/planning-chat-.*?-(t\d+.*)$/);
            const newKey = tMatch
              ? `planning-chat-${loadedName}-${tMatch[1]}`
              : savedKey;
            fetch(`/api/planning/${encodeURIComponent(newKey)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value),
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      setError(`Load failed: ${err}`);
    }
  };

  // Auto-load session from URL on mount
  const didLoadFromUrl = useRef(false);
  useEffect(() => {
    if (didLoadFromUrl.current) return;
    didLoadFromUrl.current = true;
    if (initialUrlSession.session) {
      handleLoad(initialUrlSession.session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state → URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (savedAsFile) params.set("session", savedAsFile);
    if (tab !== "update") params.set("tab", tab);
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    history.replaceState(null, "", newUrl);
  }, [savedAsFile, tab]);

  // Rerun: extract notes from current steps, re-process with current model settings
  const handleRerun = () => {
    if (!steps.length || processing) return;
    const notes = steps.map((s) => ({ text: s.noteText, label: s.noteLabel }));
    const rerunName = `${sessionName || "session"}-${modelSettings.updateModel}`;
    setSessionName(rerunName);
    handleBatch(notes);
  };

  // Avg prediction score
  const avgPrediction = (() => {
    const scores = steps.filter((s) => s.prediction).map((s) => s.prediction!.score);
    if (!scores.length) return null;
    return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
  })();

  // Duplicate: clear savedAsFile so next Save creates a new file, append "-copy" to name
  const handleDuplicate = async () => {
    if (!steps.length) return;
    const oldName = sessionName || "unsaved";
    const newName = sessionName ? `${sessionName}-copy` : "session-copy";
    // Copy planning chat files on server BEFORE changing session name so the
    // PlanningTab auto-load (triggered by name change) finds the files ready.
    await fetch("/api/planning/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldPrefix: `planning-chat-${oldName}-`,
        newPrefix: `planning-chat-${newName}-`,
      }),
    }).catch(() => {});
    setSavedAsFile(null);
    setSessionName(newName);
    setSessionVersion((v) => v + 1);
  };

  // Reset
  const handleReset = () => {
    setSteps([]);
    setError(null);
    setSessionName("");
    setSavedAsFile(null);
  };

  return (
    <div
      style={{
        fontFamily: FONT_BODY,
        minHeight: "100vh",
        background: PALETTE.cream,
      }}
    >
      {/* Focus mode toggle */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          style={{
            position: "fixed", top: 6, right: 8, zIndex: 10000,
            padding: "4px 10px", borderRadius: 6,
            border: `1px solid ${PALETTE.sand}`, background: PALETTE.white,
            color: PALETTE.inkMuted, fontSize: 11, cursor: "pointer",
            fontFamily: FONT_BODY, opacity: 0.7,
          }}
        >
          esc
        </button>
      )}

      {/* Session controls (sticky top) */}
      {!focusMode && (
        <>
        <SessionBar
          mode={mode}
          onModeChange={setMode}
          modelView={modelView}
          onViewChange={setModelView}
          prompts={prompts}
          onPromptsUpdate={setPrompts}
          modelSettings={modelSettings}
          onModelSettingsChange={setModelSettings}
          sessionName={sessionName}
          onSessionNameChange={setSessionName}
          onSave={handleSave}
          onDuplicate={handleDuplicate}
          onLoad={handleLoad}
          onDelete={(name) => {
            // If the deleted session is currently loaded, clear it
            if (sessionName === name.replace(".json", "")) {
              setSessionName("");
            }
          }}
          onLoadTest={handleBatch}
          onRerun={handleRerun}
          onReset={handleReset}
          processing={processing}
          hasSteps={steps.length > 0}
          avgPrediction={avgPrediction}
        />

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 0,
            padding: "0 20px",
            background: PALETTE.cream,
            alignItems: "center",
          }}
        >
          {(["update", "planning"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 20px",
                border: "none",
                borderBottom: `2px solid ${tab === t ? PALETTE.amber : "transparent"}`,
                background: "transparent",
                fontSize: 13,
                fontFamily: FONT_HEADING,
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? PALETTE.ink : PALETTE.inkMuted,
                cursor: "pointer",
              }}
            >
              {t === "update" ? "Model Update" : "Planning"}
            </button>
          ))}
          <button
            onClick={() => setFocusMode(true)}
            title="Hide toolbar for demo (Escape to exit)"
            style={{
              marginLeft: "auto", padding: "3px 10px", borderRadius: 6,
              border: `1px solid ${PALETTE.sand}`, background: PALETTE.white,
              color: PALETTE.inkMuted, fontSize: 11, cursor: "pointer",
              fontFamily: FONT_BODY,
            }}
          >
            Focus
          </button>
        </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            margin: "12px 20px 0",
            padding: "10px 16px",
            background: "rgba(184,92,92,0.1)",
            border: `1px solid ${PALETTE.rose}`,
            borderRadius: 8,
            fontSize: 13,
            color: PALETTE.rose,
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

      {/* Tab content */}
      {tab === "update" && (
        <ErrorBoundary fallbackLabel="Timeline render error">
          <div
            style={{
              padding: 20,
              maxWidth: 1600,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {/* Row t=0: initial state (empty models) + first note or input */}
            {steps.length === 0 ? (
              // No steps yet — show single active row
              <TimelineRow
                t={0}
                menteeModel={JSON.parse(JSON.stringify(EMPTY_MODEL))}
                mentorModel={JSON.parse(JSON.stringify(EMPTY_MODEL))}
                modelView={modelView}
                isActive={true}
                isLatest={true}
                onProcess={handleProcess}
                processing={processing}
              />
            ) : (
              <>
                {/* For each step, show: row with note + models AFTER processing, then trace */}
                {steps.map((step, i) => (
                  <div key={step.id}>
                    {/* Row t=i: the note + models after processing this note (posterior) */}
                    <TimelineRow
                      t={i}
                      menteeModel={step.menteeModelAfter}
                      mentorModel={step.mentorModelAfter}
                      previousMenteeModel={step.menteeModelBefore}
                      previousMentorModel={step.mentorModelBefore}
                      noteText={step.noteText}
                      noteLabel={step.noteLabel}
                      modelView={modelView}
                      isActive={false}
                      isLatest={false}
                      onRerunFrom={(text) => handleRerunFrom(i, text)}
                      processing={processing}
                    />

                    {/* Processing trace between t=i and t=i+1 */}
                    <StepTrace step={step} fromT={i} />
                  </div>
                ))}

                {/* Active row: input for next note, models empty until processed */}
                <TimelineRow
                  t={steps.length}
                  menteeModel={JSON.parse(JSON.stringify(EMPTY_MODEL))}
                  mentorModel={JSON.parse(JSON.stringify(EMPTY_MODEL))}
                  modelView={modelView}
                  isActive={true}
                  isLatest={true}
                  onProcess={handleProcess}
                  processing={processing}
                />
              </>
            )}
          </div>
        </ErrorBoundary>
      )}

      {tab === "planning" && (
        <ErrorBoundary fallbackLabel="Planning tab render error">
          <PlanningTab
            steps={steps}
            prompts={prompts}
            modelView={modelView}
            modelSettings={modelSettings}
            mode={mode}
            sessionName={sessionName}
            sessionVersion={sessionVersion}
            focusMode={focusMode}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
