# AI Mentor Copilot: User Model Lab

I mentor a young man from a low-income community in Boston. The relationship is what keeps him motivated. But I'm from New York. I don't know the local infrastructure: job programs, housing resources, career pathways available to him.

AI can find hundreds of options in seconds. The problem is that those options are useless unless they're personalized to what he actually values and is looking for. He cares about building things, not consulting. He cares about social impact but needs financial stability. A generic search doesn't know any of this.

This repo is the tool I built to solve that problem. It takes a sequence of free-text mentor notes, builds a structured model of who the person is (values, beliefs, goals, key relationships), and uses that model to search for and score real resources personalized to them.

[Blog post: what I learned building this](https://infinitecare.substack.com/p/ai-mentor-copilot)

## The problem

A mentor meets with someone for an hour. They write a few paragraphs of notes. Over months, those notes accumulate into a pile of unstructured text. The mentor remembers some of it. They forget most of it. When they need to help their mentee find a job, apply for a program, or navigate a family situation, they're working from a fragmentary mental model of who this person is, what they value, and what constraints they're operating under.

Can a system extract a structured, confidence-scored, bounded-size model of a person from sequential unstructured notes, update it incrementally, and use it to ground downstream planning?

## The approach

**1. Dual extraction.** Each mentor note produces two model updates. The mentee model captures their values, beliefs, goals, and relationships. The mentor model captures the mentor's own attention patterns, framing, and blind spots. The same note is evidence about both people — what the mentor chose to write down is as revealing as what the mentee said.

**2. Model-grounded conversation.** Once structured models exist, an AI agent uses them to help the mentor research options. The agent cites specific model entries when making suggestions, flags tensions between the mentee's values and their constraints, and tracks the mentor's intent in a structured workspace.

**3. Personalized resource scoring.** The system searches for real resources (jobs, programs, tools), generates scoring dimensions from the person model, and scores each resource on each dimension. The output is an interactive page where the mentor can re-weight what matters and re-rank options.

## What each stage looks like

### Stage 1: Note → Mentee model + Mentor model

![Model Update](assets/model-update.png)

Each row shows a mentor note (left) and the two models extracted from it (center and right). The layout reads left-to-right as input → output.

The **mentee model** (center) extracts values, beliefs, and goals with confidence scores — each accumulating evidence across notes (the `(2)` prefix means two notes contributed). Beliefs are quoted from the mentee's words: *"Big tech is ethically compromised, especially around data practices."*

The **mentor model** (right) extracts what the note reveals about the *mentor*. "Surfacing internal tensions in mentees" describes an attention pattern. The mentor's goal, "Help Jordan navigate the values-vs-livelihood tension before graduation," captures what the mentor is optimizing for. This is not the mentee's goal. It is the mentor's framing of the problem.

The model has fixed capacity — each update replaces the prior, and what to forget is an open problem.

### Stage 2: Model-grounded conversation

![Planning Chat](assets/planning-chat.png)

The planning tab uses the accumulated models to help the mentor research options. Three panes: models (left), conversation (center), workspace (right).

The **conversation** (center) is between the mentor and a research librarian agent. The agent cites model entries by ID — `(1)`, `(2)`, `(3)` reference specific values, beliefs, or people-claims — so every suggestion traces back to evidence about the person.

The **workspace** (right) tracks structured state derived from the models. **Understanding** lists scoring dimensions tagged with citations: `+ Hands-on building roles, not consulting or policy [MV4] [MB3]` means this dimension is grounded in mentee value 4 and mentee belief 3. The `+` and `~` prefixes indicate fit vs. tension. **Constraints** distinguish confirmed requirements (`✓ Graduating May [MG2]`) from soft inferences (`~ Sam likely wants Jordan nearby [MP6] [MP2]`).

### Stage 3: Personalized resource board

![Resource Board](assets/resource-board.png)

After researching across 10 domains, the system scores 108 resources on dimensions derived from the mentee's model and produces an interactive artifact page.

**Filter pills** across the top are the scoring dimensions. The mentor toggles dimensions on/off and the ranking updates live. "71 of 108 — 37 didn't meet requirements" reflects the current filter state.

The **left sidebar** shows the person model that grounds the scoring. This is where the `people` field becomes visible: the mentee model represents specific people in the mentee's life with two sub-arrays — **situation** (observable facts like "Matched into residency at UPMC in Pittsburgh") and **innerModel** (the mentee's interpretation of what this person thinks or feels, like "Sam's mother is not doing well health-wise"). These are attributed beliefs, not recursive inference over nested mental models. Key values appear below with evidence quotes from the original notes.

Every recommendation traces back to specific model entries. The mentor sees why something ranks high and can override it.

## Prediction-based evaluation

Before processing note *k*, the system generates a factual question from the note, then predicts the answer using only model *k-1*. A prediction score (0-1, LLM-judged) tracks how well the model anticipates new observations.

This is an informal version of held-out log-likelihood: if the model can predict what shows up in the next note, it is capturing something real. But it tests surface-level predictive accuracy, not whether the model has captured latent structure. A model that tracks recurring topics without inferring underlying values would score well. The LLM judge adds a further confound. Still, it provides a continuous signal for iterating on prompts and model structure without labeled data.

## Technical details

The model has a fixed capacity. Each update replaces the prior estimate rather than appending to an unbounded log. Confidence scores (0-1) on every field. Evidence is direct quotes from notes, never fabricated. What to forget is delegated to the LLM's judgment via prompts; formalizing this as a retention policy is an open problem.

The model schema is not hardcoded. `UserModel` is `Record<string, unknown>`, and the system dispatches on shape at runtime: arrays get add/update/remove deltas, objects with sub-arrays get nested merging. The schema emerges from the LLM's output, guided by the prompt's JSON template. Whether the LLM discovers useful structure beyond what the template suggests is an open question about inductive bias.

Every model entry gets a numbered ID: `[MV1]` for the first mentee value, `[MB2]` for the second mentee belief, `[MP3]` for the third person-claim. These IDs flow from the model through the planning chat to the workspace to the artifact.

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

Open `http://localhost:5174`. Paste or drag-drop mentor notes into the timeline.

## Status

This is an active personal project, motivated by a broader goal: AI that helps mentors with limited time and limited knowledge of available systems serve more people — not by replacing mentors, but by streamlining the work outside the relationship. The pipeline works end-to-end, but I haven't run systematic evaluations yet. The immediate question is whether prediction accuracy correlates with downstream planning quality: whether a better model produces better-scored resources. I'm open to collaborators, especially on evaluation methodology and scaling beyond single-case mentoring.

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
│       ├── TimelineRow.tsx       # Single note: note + posterior models
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
