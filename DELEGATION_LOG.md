# Delegation log

## 2026-11-04 - Milestone 1 research spike

- **Task:** Verify current Copilot app canvas-extension documentation and awesome-copilot examples; analyze local usage-source feasibility; propose portable core and adapter architecture. No implementation or knowledge-bank authoring.
- **Requested and selected model:** Claude Opus 5.5 (`claude-opus-5.5`) through `acpRegistry_github_copilot`.
- **Availability check:** T3 orchestration capabilities confirmed this provider can run child tasks with the requested model. The separate Claude provider is disabled; the Copilot provider supports the model.
- **Task ID:** `node:delegated-task:command%3Amcp%3A7914fcb0-c86a-4c65-8125-049836da47cd%3Adelegate-task%3A091d25d2-2986-49fa-a303-95c1e6ae8218`
- **Outcome:** Completed. Two responses delivered the public-docs/API research and an addendum comparing the parent's local observations with public SDK fields. Sources, preview caveats, unknown metric semantics, and architecture recommendations are incorporated into SPIKE_REPORT.md. No implementation performed.
- **Parent synthesis corrections:** Preserved the user's milestone order (knowledge bank and rule design before the shell/canvas); separated reported counters from schema support; left unconfirmed cache ratios unavailable rather than manufacturing estimates; distinguished agent-reported completion from verified success; corrected the blanket ACP-unavailable claim because this Copilot-backed T3 session has observable Copilot records. A dedicated T3 adapter remains unverified.
- **Privacy boundary:** Child research uses public documentation. Parent inspects local database schemas and metric-field coverage read-only; no transcript contents or private usage values are sent to external research services.

### Parent's local inspection

Observed on this installation, not a supported API guarantee:

- `~\.copilot\session-store.db`: `assistant_usage_events` includes input/output, cache-read/cache-write, reasoning, model, attribution, timing, and token-detail columns.
- In the most recent 200 usage rows, input/output/cache-read/cache-write/token-detail fields were non-null in all 200; reasoning was non-null in 197. Presence does not establish semantic accuracy or universal provider support.
- Token-detail objects have `batchSize`, `costPerBatch`, `tokenCount`, `tokenType`, and `model` keys. Observed type labels: `input`, `cache_read`, `cache_write`, `output`. These do not independently establish a portable cache-hit denominator or currency cost.
- `~\.copilot\data.db`: `session_context_usage` includes `session_id`, `ts_ms`, `current_tokens`, and `token_limit`. The most recent 200 rows all have non-null counters and positive limits. Snapshot completeness and token-count methodology remain unverified.
- Recent `~\.copilot\session-state\<session>\events.jsonl` files contain `session.usage_record` with numeric usage fields and accounting identifiers; tool telemetry can include context-current/context-limit metrics.
- `~\.t3\userdata\statev2.sqlite` has orchestration event and projection tables with JSON payloads; a dedicated usage table was not identified. No conclusion that usage is absent.
- A bounded scan of three recent Copilot process logs found none of the specific token-field labels searched. This does not prove logs never contain usage.
- No transcript text, credentials, or actual per-session usage values were printed. No source databases were modified.

## 2026-11-04 - Copilot-only implementation

- **Scope change:** The user approved implementation and narrowed the product to GitHub Copilot canvas only. No standalone shell or other-vendor adapter work.
- **Task:** Author approximately 30 source-verified Copilot learning items and design conservative, replay-resistant achievement eligibility and XP rules.
- **Model:** Claude Opus 5.5 (`claude-opus-5.5`) through `acpRegistry_github_copilot`.
- **Task ID:** `node:delegated-task:command%3Amcp%3A7914fcb0-c86a-4c65-8125-049836da47cd%3Adelegate-task%3A60a49b8d-f5ee-438b-a03a-cbf32c7bd0b6`
- **Outcome:** Completed. Child authored 38 verified items spanning seven categories and returned conservative, idempotent rule designs. Parent excluded one item with conflicting compaction-threshold documentation, leaving 37 items; it is deferred rather than presenting disputed percentages as fact.
- **Rule integration:** Implemented the suggested seven milestones and daily learning reward. Fact discovery requires explicit acknowledgment instead of unreliable passive dwell telemetry. Reflections award only the three-distinct-days milestone, never XP per click. First-encounter correctness is tracked by stable question ID so replays/rewording cannot farm milestone XP.
- **Privacy:** Public GitHub/MCP documentation only. No private local transcript or usage values shared.

## 2026-11-04 - Final core review before canvas wrapper

- **Task:** Read-only correctness review of core, shared service, persistence, Copilot adapter, and associated tests before implementing the experimental canvas wrapper.
- **Model:** Claude Opus 5.5 (`claude-opus-5.5`) through `acpRegistry_github_copilot`.
- **Task ID:** `node:delegated-task:command%3Amcp%3A7914fcb0-c86a-4c65-8125-049836da47cd%3Adelegate-task%3A3548e9a4-54ed-46cb-87c3-c5d2b8206475`
- **Outcome:** Completed. One high, four medium, and five low correctness findings. Parent fixed stale-content achievement availability, daily-error isolation, unreported cache zeros, ambiguous cross-format deduplication, older-sync replacement, timestamp ordering, foreign-session attribution, optional fact answers, retired-item learning metadata, and rollback error masking. Added regression tests; the reviewed core was not changed during the review.

## 2026-11-04 - Real-host integration debugging

- **Task:** Debug only the isolated real Copilot runtime smoke after two failed parent attempts. First failure required an explicit SDK path; the second required an extension launch provider.
- **Model:** Claude Opus 5.5 (`claude-opus-5.5`) through `acpRegistry_github_copilot`.
- **Task ID:** `node:delegated-task:command%3Amcp%3A7914fcb0-c86a-4c65-8125-049836da47cd%3Adelegate-task%3Aa2c5b476-490d-44d3-b5bf-1345ad98fd75`
- **Outcome:** Completed. Child changed only `scripts\smoke-host.ts`: added the experimental extension launch provider, selected the executable using `RuntimeConnection.forStdio`, and handled asynchronous registration. Three consecutive runs passed against Copilot 1.0.105 (protocol 3): project extension discovery, canvas open with HTTP 200, `get_profile` action invocation, and close. Temporary storage and child processes were cleaned up.
- **Boundary:** No model prompt was sent or private profile used. The runtime may make its own startup network calls; this smoke does not establish host-wide offline behavior. It checks real runtime integration, not the Copilot app's right-hand panel.
