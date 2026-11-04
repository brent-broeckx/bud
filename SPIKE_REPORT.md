# Bud - milestone 1 research spike and proposed plan

Verified/read on 2026-11-04. No application code has been written.

## Recommendation

Proceed with a portable TypeScript core, a local standalone shell, a read-only Copilot JSONL adapter, and finally a thin project-scoped canvas extension. Real token counters exist on this installation: transcript-length estimation is not necessary for those counters. However, a recorded counter is not proof of a successful task, complete context coverage, or cache efficiency.

The canvas integration is feasible but experimental. Keep its APIs, runtime assumptions, and storage paths out of the core. Preserve the requested milestone order; knowledge content and achievement rules belong in the core milestone, not after the canvas.

## Evidence and confidence

The research and architecture analysis were delegated to Claude Opus 5.5 through the Copilot provider. The main agent separately inspected local schemas and field presence read-only. See DELEGATION_LOG.md.

- **Official product docs:** supported workflows and storage locations.
- **Public SDK source:** current typed APIs, including experimental/internal fields; not a compatibility guarantee.
- **awesome-copilot examples:** useful implementation patterns, not authoritative metric semantics.
- **Local observations:** this installation only; undocumented schemas must be probed before use.

### Public sources read by the research delegate

1. [Working with canvas extensions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
2. [Built-in skills reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills)
3. [CLI configuration directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
4. [About session data](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/session-data)
5. [CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
6. [SDK canvas types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/canvas.ts), [extension entry API](https://github.com/github/copilot-sdk/blob/main/nodejs/src/extension.ts), [event types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts), and [RPC types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/rpc.ts)
7. [awesome-copilot](https://github.com/github/awesome-copilot/tree/7e40881): `chronicle-stats`, `ai-credits-breakdown`, and `token-pacman` canvas examples, Learning Hub guidance, and canvas evidence/metrics guidance.
8. [T3 Code usage documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/usage.md)

SDK links point to a moving branch. Pin an SDK revision and re-check the host API before implementing milestone 5. Example observations were reported against awesome-copilot revision `7e40881`.

## Canvas extension findings

### Discovery, structure, and creation

- Project extensions live in `.github\extensions\<name>\`, relative to the Git root.
- User extensions live in `~\.copilot\extensions\<name>\`; `COPILOT_HOME` can change the home location.
- Immediate child directories are discovered. A same-named project extension takes precedence over a user extension.
- Recognized entry files, in order, are `extension.mjs`, `extension.cjs`, and `extension.js`. The host does not execute TypeScript entry files: compile/bundle the core into JavaScript.
- The docs describe `package.json`, an extension entry file, and optional `artifacts\` files.
- Examples also include `copilot-extension.json`; its role was not established by official docs. Do not invent a manifest contract.
- `/create-canvas` is a built-in app skill supporting project/user scope. Scaffolding and reload tools also exist.
- The SDK is host-provided according to the docs. Examples declaring an SDK dependency do not override that guidance. Reconcile packaging with the installed host before shipping; do not blindly install `latest`.

The current workspace is not a Git repository. Project-scoped discovery will require a Git root before milestone 5; no repository has been initialized during this spike.

### SDK and rendering

The public extension module is `@github/copilot-sdk/extension`. The researched pattern is `joinSession({ canvases: [createCanvas(...)] })`; this is part of the SDK extension protocol, not a separate invented app SDK.

`createCanvas` declares an ID, display name, description, optional input schema, an `open` handler, optional actions, and optional `onClose`. The open handler receives session/extension/canvas/instance identifiers and can return a URL, title, and status. Action handlers are agent-callable through `invoke_canvas_action`. Action names cannot start with `canvas.`.

The APIs are marked experimental. Reopening an existing instance focuses it. The researched examples render by returning a loopback HTTP URL; no supported URL-free rendering method was established.

Each extension runs as a child process using stdio JSON-RPC. Use `session.log`, not stdout, for logs. Keep lifecycle cleanup explicit and do not assume the extension process outlives a session.

The examples protect their local servers with secret URLs, Host/Origin checks, and CSP. Bud should additionally bind only to loopback, validate action payloads, and keep mutations off GET requests. Its UI should bundle fonts/assets and make no analytics or CDN requests.

### Storage

Distinguish temporary session artifacts from persistent Bud progress:

| Purpose | Proposed treatment |
|---|---|
| Session-specific artifacts | Session-state `files\` location; never the sole home of XP/profile state |
| Profile, XP ledger, unlocks, answers | Extension-scoped/local Bud data directory shared by both shells |
| Project installation | Wrapper code in `.github\extensions\bud\`; personal progress outside tracked project files |

Learning Hub guidance and examples use `~\.copilot\extensions\<extensionId>\` for cross-session extension persistence. Official configuration docs also describe `plugin-data\` for installed plugins. Neither establishes a universal durable-storage SDK contract. Resolve the Bud data location through an injected host/storage configuration, respect `COPILOT_HOME`, and document export/reset behavior.

Multiple sessions and the standalone shell may mutate the same profile. Use one transactional storage boundary with cross-process locking, revision checks, and crash recovery. Example JSON persistence uses exclusive lock creation and temporary-file/rename writes. Do not assume rename alone makes a multi-file ledger transaction atomic.

## What local usage data actually exists

The parent inspected only schemas, event field shapes, and aggregate field coverage. No transcript text, credentials, or actual per-session usage values were printed or uploaded. Source databases were opened read-only.

| Local source | Observed evidence | Limits |
|---|---|---|
| `~\.copilot\session-state\<id>\events.jsonl` | `session.usage_record` containing input/output/cache-read/cache-write/reasoning counters; accounting usage IDs; some prompt/output limits | Observed event name is not in the researched public schema; requires versioned normalization |
| Public SDK event schema | `assistant.usage`, `session.usage_info`, completion/compaction events | Typed fields do not guarantee every provider emits or persists them |
| `~\.copilot\session-store.db` | `assistant_usage_events` with token/cache/model/agent/timing fields and token-detail JSON | Internal schema; cannot assume row IDs match JSONL usage IDs |
| `~\.copilot\data.db` | `session_context_usage(session_id, ts_ms, current_tokens, token_limit)` | Internal app snapshots; methodology and completeness unconfirmed |
| `~\.copilot\logs\process-*.log` | Process logs exist | A bounded scan of three recent logs found none of the searched token labels; not proof that all logs lack usage |
| `~\.t3\userdata\statev2.sqlite` | Orchestration event/projection tables with JSON payloads | No dedicated usage table identified; payload semantics and supported export unverified |

In the latest 200 store usage rows, input/output/cache-read/cache-write/token-detail fields were all present; reasoning was present in 197. In the latest 200 context rows, counters were present and limits positive. These are coverage observations, not universal provider guarantees.

Token-detail objects contain `tokenCount`, `tokenType`, `model`, `batchSize`, and `costPerBatch`. Observed type labels include input, output, cache read, and cache write. This does not establish a currency conversion or whether input includes cached tokens.

**Important distinction:** a dedicated T3 adapter is not yet established. That does not mean all Copilot-via-T3 usage is unavailable: the current Copilot-backed sessions produced local Copilot event records during this spike. Read them as Copilot-source evidence; T3 attribution and coverage remain unverified. Do not infer either complete ACP coverage or complete absence.

Do not invoke `/chronicle reindex` as a local import mechanism: the researched docs describe account synchronization. Bud must never enable sync or upload records. Bud being local does not disable telemetry/sync already configured in its host.

## Exact, estimated, and unavailable achievements

Use the label **Reported** for source-supplied counters, **Estimated** for calculations requiring assumptions, and **Unavailable** when evidence or semantics are insufficient. "Reported" is not independent verification. Never turn missing values into zero.

| Candidate | Feasibility and evidence needed |
|---|---|
| Answer a daily question; explore learning categories | Exact Bud-local answer/streak ledger; cap rewards and make retries non-punitive |
| Completed task under half the context window | Not exact from sparse snapshots. Needs bounded task interval, completion evidence, compatible numerator/limit, and coverage. May display sampled usage as estimated; do not award an exact whole-task threshold |
| High-cache-hit streak | Raw cache counters are reported. Ratio denominator/provider semantics and coverage remain unconfirmed; defer the ratio-based award rather than invent a percentage |
| Disabled an unused MCP server | Needs before/after configuration evidence plus a defined observation window for tool use. A tool-load event alone proves neither disuse nor disabling. No automatic award yet |
| Wrote lean instructions | Bytes/lines are exact with consent to inspect the file; tokens require a verified matching tokenizer or an estimate. Brevity does not prove quality; rule design must avoid rewarding destructive trimming |
| Started fresh rather than extending a bloated session | Session starts can be observed. Intent, related-task linkage, and "bloated" need stronger evidence; use a clearly user-reported reflection or defer |
| First observed skill/subagent/MCP use | Exact observed event if emitted; means first in imported history, not lifetime first. Prefer learning-oriented, one-time recognition, not rewards for repeated tool calls |
| Compaction occurred | Event occurrence can be reported; compaction token counts can explicitly be local estimates. Do not reward unnecessary compaction |
| Cache savings, money/credits saved | Not established for v1. Pricing, billing basis, overlap, and missing usage prevent reliable claims |

`assistant.turn_end`, finish reasons, and session shutdown are not task-success evidence. A successful `session.task_complete` is **agent-reported completion**, not independently verified correctness. Preserve that distinction from user confirmation or a verifiable completion receipt.

Sampled context peaks are lower bounds on the true peak. A lower bound below 50% cannot prove the true peak was below 50%. Do not mix effective prompt limits with full context-window limits or sum context snapshots as token spend.

## Proposed architecture and contracts

Keep the requested core layer UI-free and provider-neutral:

- **Core:** usage-event contracts, deterministic achievement evaluation, XP/level progression, avatar inventory/equipment rules, question validation/selection, answer/streak logic, and storage interfaces. Inject clock, calendar policy, and randomness.
- **Adapters:** Copilot JSONL first, live SDK later, SQLite fallback only after schema checks. A fake adapter drives core tests. A future T3 adapter is separate from the Copilot adapter.
- **Local persistence implementation:** owns transactions and locking; stores only normalized allowlisted metrics and Bud progress, not transcript bodies.
- **Standalone shell:** local web app using the same core service.
- **Canvas wrapper:** compiled JavaScript entry, local page, and thin action handlers using that same service.

Each normalized event needs source/session identity, stable source event identity where available, timestamp, schema version/fingerprint, metric provenance, and explicit coverage. Distinguish usage calls, context samples, feature observations, completion evidence, and configuration observations.

Each metric needs value-or-missing, measurement method (`reported`, `estimated`, `unavailable`), support status (`public`, `internal`, `observed`), unit, and calculation basis. Availability and certainty are separate dimensions. An internal reported counter must not be silently discarded or relabeled as an estimate solely because its schema is internal.

Adapters should expose a capability probe and an incremental scan with a resumable cursor and cancellation. Unknown schemas produce visible diagnostics and disable unsupported rules; do not silently succeed with empty data. Unknown fields must not enter the stored allowlist.

Use source-scoped accounting/event keys for import idempotency. `(sourceSessionId, usageId)` is a candidate within the source, not a proven cross-source join. Choose one authoritative usage source per session until overlap can be reconciled; never add JSONL, database, and shutdown totals together.

Windows import cursors must tolerate append, partial lines, replacement, truncation, and resume; do not depend solely on Unix inode semantics. Commit imported events and cursor advancement together.

Derive XP/unlocks from an idempotent award ledger. Transactions must atomically record an award and its eligibility evidence; unique award IDs prevent replay awards. Equipping checks ownership and slot compatibility. Both agent and UI mutations pass through the same validated commands.

Proposed public commands: `get_profile`, `get_daily_question`, `submit_answer`, `list_achievements`, `equip_item`; plus explicit `sync_usage` and `explain_metric`. Action responses should be minimal, with no raw transcript data. Once a user or agent explicitly requests a result in chat, the host may include it in model context; disclose that boundary and keep background import entirely local.

## Knowledge-bank work

No set of 30 facts has been authored or claimed verified in this spike. The later Opus delegation must read each source claim, not merely check URL reachability.

Target approximately 30 JSON items across context windows, caching, tokenization, agents/tool use, MCP, SDK basics, and cost/usage habits. Each has the requested ID, category, difficulty, type, question, answer options, explanation, source URL, verified-on date, and may-go-stale flag. Quizzes also need an unambiguous correct answer; did-you-know items need an explicit non-quiz shape.

Candidate official sources include the Copilot SDK/event docs above, Anthropic context/prompt-caching/token-counting docs, OpenAI prompt-caching docs and tiktoken, and the MCP specification. Candidate sources are not yet verified knowledge-bank entries. Avoid hard-coded model limits/prices when a durable conceptual question works better. Exclude unverifiable claims and flag them in the authoring outcome.

Daily selection should be deterministic for a profile/day, rotate categories and difficulty, avoid repeats until the pool is exhausted, and define timezone/day-boundary behavior. Wrong answers reveal the explanation with no XP loss or streak punishment. Award daily learning XP once, not once per retry or shell.

## Proposed implementation milestones

1. **This spike and plan:** complete. Resolve the cache denominator, context semantics, and source-ID questions before enabling affected usage awards; they do not block fake-data core development.
2. **Core with fake usage:** scaffold TypeScript packages; delegate anti-gaming achievement design and verified knowledge authoring to Opus; implement storage, XP/levels/avatar, daily selection and approximately 30 verified items. Unit-test boundaries, unsupported evidence, duplicates, replay, stale content, wrong answers, daily rollover, and concurrent mutations.
3. **Standalone shell:** avatar customization, daily learning, achievement collection, provenance/coverage labels, and clear empty/error states. No fabricated sample usage mixed with real profiles; demo mode must be explicit.
4. **Real adapter:** Copilot JSONL first, because rich per-call evidence is observed here and it avoids SQLite runtime constraints. Probe both event names; test synthetic/redacted structural fixtures, partial writes, resets, missing fields, and source overlap. Keep private schemas isolated. Add SQLite fallback only if it fills a demonstrated gap.
5. **Canvas wrapper:** first delegate the requested final core review to Opus and fix findings. Reverify the installed experimental SDK/runtime, compile the entry, install project-scoped, and expose the same commands as the shell. Validate shared state, concurrent use, local-only serving, and extension restart persistence.

No leaderboards, team sharing, spending rewards, usage-volume farming, or network sync. Good-habit eligibility must remain conservative: unavailable achievements can be explained honestly instead of manufacturing evidence.
