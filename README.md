# AI Mentor Copilot: User Model Lab

I mentor someone from a low-income community and built software to support that work. The bottleneck was never the app. The bottleneck was this: how do you maintain a structured, evolving model of a person from unstructured session notes?

This repo is the research tool I built to iterate on that question. It takes a sequence of free-text mentor notes and builds two models in parallel: one of the mentee, one of the mentor. It evaluates itself by predicting what each new note will contain before reading it.

I come from a low-income background where I watched brilliant peers fall short of their potential, not because they lacked capacity but because they lacked access to mentorship. I want to help expand who has access. Not by replacing mentors with AI, but by building AI that helps mentors with limited time and limited knowledge of available systems serve more people. By streamlining the work *outside* the relationship (research, planning, tracking progress), a single mentor can take on more mentees, or someone who didn't have time to mentor can start.

## Model Update: Note → Dual Extraction

<!-- screenshot: model update tab showing a single row with note on left, mentee model center, mentor model right -->

Each row in the timeline shows a mentor note (left) and the two models extracted from it (center and right). The layout reads left-to-right as input → output.

**The mentor note** (left column) is free-text written by the mentor after a session. In the screenshot, the mentor writes about a mentee who "came in really energized" about a side project, "can't do a job where I'm just making slides," and has strong feelings about data ethics. This is unstructured. The system's job is to turn it into structured models.

**The mentee model** (center column) extracts the mentee's values, beliefs, and goals with confidence scores. From that note: "Social impact" (0.5), "Data ethics and privacy" (0.4), "Financial stability" (0.4). Each entry accumulates evidence across notes. The `(2)` prefix means two notes have contributed evidence for that entry. Beliefs are quoted from the mentee's own words: *"Big tech is ethically compromised, especially around data practices."*

**The mentor model** (right column) extracts what the note reveals about the *mentor*, not the mentee. "Surfacing internal tensions in mentees" (0.5) and "Translating mentee self-knowledge into concrete actionable options" (0.7) describe the mentor's attention patterns. The mentor model's goal, "Help Jordan navigate the values-vs-livelihood tension before graduation" (0.4), captures what the mentor is optimizing for. This connects to work on observer models in cognitive science (Griffiths et al., 2008; Shafto et al., 2014): the observation channel is not neutral, and modeling the observer alongside the observed recovers information that a single-model approach loses.

The mentee model also includes a `people` field for specific people in the mentee's life. Each person has two sub-arrays: **situation** (observable facts, higher confidence) and **innerModel** (the mentee's reported interpretation of what this person thinks or feels). This captures attributed beliefs, not recursive inference over nested mental models.

**Prediction-based evaluation.** Before processing note *k*, the system generates a factual question from the note, then predicts the answer using only model *k-1*. A prediction score (0-1, LLM-judged) tracks how well the model anticipates new observations. This is an informal version of held-out log-likelihood: if the model can predict what shows up in the next note, it is capturing something real. But it tests surface-level predictive accuracy, not whether the model has captured latent structure. A model that tracks recurring topics without inferring underlying values would score well. The LLM judge adds a further confound. As a signal for rapid iteration on prompts and model structure, it is more useful than no evaluation at all.

**Bounded user modeling.** The model has a fixed capacity. Each update replaces the prior estimate rather than appending to an unbounded log. This is closer to a rational agent maintaining a bounded memory (Anderson, 1990) than to a Kalman filter (which assumes linear dynamics and Gaussian noise absent here). Confidence scores (0-1) on every field. Evidence is direct quotes from notes, never fabricated. What to forget is currently delegated to the LLM's judgment via prompts; formalizing this as a retention policy is an open problem.

The model schema is not hardcoded. `UserModel` is `Record<string, unknown>`, and the system dispatches on shape at runtime: arrays get add/update/remove deltas, objects with sub-arrays get nested merging. The schema emerges from the LLM's output, guided by the prompt's JSON template. Whether the LLM discovers useful structure beyond what the template suggests is an open question about inductive bias.

## Planning: Model-Grounded Research

<!-- screenshot: planning tab showing three-column layout with models, planning chat, and workspace -->

The planning tab uses the accumulated models to help the mentor research real options for the mentee.

**Mentee and mentor models** (left pane) show the current state of both models with confidence bars. These are the same models built by the update pipeline. They provide the grounding for everything the planning workspace does.

**The planning chat** (center pane) is a conversation between the mentor and a research librarian agent. The agent clarifies the mentor's intent, suggests research domains, and presents options with inline model citations. In the screenshot, the mentor asks about jobs in cities near Pittsburgh. The agent responds with options like "Ed tech" and "Privacy-focused startups," citing numbered references `(1)`, `(2)`, `(3)` that link back to specific model entries. The agent does not advise. It presents options and lets the mentor choose.

**The workspace** (right pane) tracks the structured state of the planning session. The **Goal** at the top summarizes what the mentor is looking for. **Understanding** lists scoring dimensions derived from the person model, each tagged with model citations: `+ Hands-on building roles, not consulting or policy [MV4] [MB3]`, `- AI safety/policy roles — too abstract for Jordan [MB6]`. The `+` and `-` prefixes indicate fit vs. tension. **Constraints** show hard requirements with `✓` (confirmed) and `~` (soft/inferred): `✓ Graduating May — needs roles starting summer 2026 [MG2]`, `~ Sam likely wants Jordan nearby [MP6] [MP2]`.

The planning pipeline runs web searches for real resources, deduplicates across domains, generates scoring dimensions from the model, scores each resource on each dimension (0-1 with a brief signal), and can produce a self-contained interactive HTML artifact where the mentor re-weights dimensions and re-ranks options client-side.

**Model citation framework.** Every model entry gets a numbered ID: `[MV1]` for the first mentee value, `[MB2]` for the second mentee belief, `[MP3]` for the third person-claim. These IDs flow through from the model to the planning chat to the workspace to the artifact. Every recommendation traces back to specific evidence about the person.

## How it works

```
Note → Dual extraction (mentee + mentor) → Delta merge → Model update
     → Prediction evaluation (question from note k+1, predict from model k, score)
```

The planning pipeline extends this:

```
Mentor conversation → Intent clarification → Research domains
    → Web search (real URLs) → Deduplicate across domains
    → Generate scoring dimensions from model ([MV1], [MP3], ...)
    → Score each resource on each dimension (0-1 + signal)
    → Interactive artifact page (client-side re-ranking)
```

## Architecture

- **Runtime**: Bun
- **Frontend**: React 18 + TypeScript, Vite dev server
- **Backend**: Express server that proxies to `claude -p` (Claude CLI). No API key needed.
- **Persistence**: Sessions saved as JSON files on disk. No database. Prompts cached in localStorage.
- **AI**: All LLM calls go through a single `/api/process` endpoint that spawns `claude -p --output-format json`.

## Running locally

Prerequisites: [Bun](https://bun.sh), [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) with an active subscription.

```bash
bun install

# Start the backend (port 3001)
bun run server.ts &

# Start the frontend (port 5174)
bunx vite
```

Open `http://localhost:5174`. Paste or drag-drop mentor notes into the timeline. The system processes them sequentially, building models and scoring predictions.

## Status

This is an active personal project. The pipeline works end-to-end, but I haven't run systematic evaluations yet. The immediate question is whether prediction accuracy correlates with downstream planning quality: whether a better model produces better-scored resources. I'm interested in pursuing this further and open to collaborators, especially on evaluation methodology and scaling beyond single-case mentoring.

## Project structure

```
├── server.ts                     # Express server, proxies to claude -p
├── src/
│   ├── App.tsx                   # Main app: timeline + planning tabs
│   ├── types.ts                  # UserModel, ProcessingStep, PlanningWorkspace
│   ├── update.ts                 # Model update pipeline, delta merging, prediction, planning
│   ├── prompts.ts                # All LLM prompts (editable at runtime)
│   ├── generateArtifactPage.ts   # Self-contained HTML artifact generator
│   ├── theme.ts                  # Color palette, typography
│   └── components/
│       ├── TimelineRow.tsx       # Single note: before/after models + delta trace
│       ├── ModelView.tsx         # Renders a UserModel with color-coded sections
│       ├── StepTrace.tsx         # Expandable processing trace (prompts, raw responses)
│       ├── PlanningTab.tsx       # Research librarian conversation + workspace
│       ├── WorkspacePanel.tsx    # Domain list, resource scoring, artifact generation
│       ├── PromptEditor.tsx      # Edit any prompt at runtime, reset to defaults
│       ├── SessionBar.tsx        # Save/load/duplicate sessions
│       └── ErrorBoundary.tsx     # React error boundary
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tests/                        # Test data (gitignored, private notes)
```
