# Bud

A private, playful **GitHub Copilot canvas** companion. Learn one useful thing a day, collect good-habit milestones, and customize a small bot as it grows.

This version targets the GitHub Copilot app only. There is no standalone product, other-provider integration, leaderboard, or cloud backend.

## Install in this repository

Requires Node **22.13+**, npm, and a GitHub Copilot app host that supports experimental canvas extensions.

```powershell
npm ci
npm run build
```

The build produces `.github\extensions\bud\extension.mjs`, package metadata, and third-party license notices. The entry bundles the UI, verified content, and application logic. The SDK is **not bundled**: Copilot supplies `@github/copilot-sdk/extension` when it starts the extension. The pinned development dependency is used for compile-time API checks.

Open this repository in the GitHub Copilot app. Reload extensions (or start a fresh session), then ask:

> Open the Bud canvas.

Project extension discovery requires a Git root. To use Bud in another repository, copy the built `bud` directory into that repository's `.github\extensions\` directory. Do not copy personal profile data or `node_modules`.

The canvas API is experimental. See [GitHub's canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions). The build targets the SDK 1.0.28 API; the host must provide compatible `createCanvas` and `joinSession` exports.

## What you can do

- Answer a daily question or discover a fact. Learning earns XP regardless of correctness.
- Keep a gentle daily streak. Missing a day never removes XP or cosmetics.
- Equip unlocked colors, headwear, outfits, and titles.
- Collect one-time learning milestones and clearly self-reported habit reflections.
- Read the **current session's** local usage counters explicitly. Bud never estimates spend from transcript length.

The user and agent share the same service and persistent profile. Canvas actions include `get_profile`, `get_daily_question`, `submit_answer`, `list_achievements`, `equip_item`, `record_reflection`, and `sync_usage`. Usage import requires explicit local-read consent. Agents should only call it when the user requests it.

## Privacy and evidence

Personal progress is stored outside the repository in:

```text
<COPILOT_HOME>\extensions\bud\artifacts\profile.sqlite
```

`COPILOT_HOME` defaults to `~\.copilot`. `BUD_DATA_DIR` can override Bud's data directory. SQLite transactions protect simultaneous windows/processes; no Copilot database is modified.

Usage import reads only `<COPILOT_HOME>\session-state\<SESSION_ID>\events.jsonl`. Only normalized, allowlisted counters are saved. Transcript bodies, prompts, tool results, credentials, and raw event payloads are not retained. Reading happens on request, not continuously in the background. The importer currently limits one log to 64 MB and reports malformed lines or unsupported metrics.

Bud has no outbound network requests, analytics, remote fonts, or automatic synchronization. Official source links open only when clicked. **Host behavior is separate:** an agent-callable result enters the Copilot conversation when requested, and Bud cannot change the app's own sync/telemetry settings. Do not request private results in chat if you do not want them in model context.

Counters are marked **Reported**, with field-level coverage. Missing data is **Unavailable**, never silently zero. Context values are samples, not proven peaks. Cache ratios, monetary savings, and "completed a task below half the context window" awards are deliberately unavailable until their evidence can be established. Self-reported reflections are never presented as measured efficiency.

This is a local game, not a fraud-resistant economy: changing your computer clock or editing your own profile can manipulate progress. The server accepts no client-supplied XP, reward IDs, level, or completion dates; ordinary retries and overlapping windows cannot duplicate rewards.

## Learning content

`content\questions.json` contains 37 source-linked quiz/fact entries with category, difficulty, explanation, verification date, and a staleness flag. One disputed compaction-threshold item was excluded. Time-sensitive items stop being newly selected after 90 days until reverified; their dates are never automatically refreshed. Achievements that cannot be reached with the remaining eligible content are marked unavailable until new verified content arrives. Daily selection rotates categories/difficulty, avoids immediate pool repeats, and uses the profile's initial local timezone consistently across sessions.

If daily learning is unavailable (for example after a clock rollback or a content update), Bud shows the reason without disabling the wardrobe, profile, or usage import. Completed discoveries retain their category/difficulty metadata so retiring a question does not erase earned progress.

## Development

```powershell
npm test
npm run typecheck
npm run build
npm run dev
```

`dev` is a **canvas renderer test harness**, not a separate supported shell. It uses isolated `.bud-dev` storage and explicitly synthetic current-session usage; it never reads your Copilot history. It prints a secret loopback URL and stops on Ctrl+C.

The core has no UI or Copilot SDK dependency. Tests exercise fake usage, question rotation, wrong answers, daily boundaries, idempotent rewards, cosmetic locks, adapter missing/zero semantics, privacy allowlisting, durable transactions, and HTTP request boundaries.

To exercise real runtime discovery and agent actions without sending a model prompt:

```powershell
npx tsx scripts\smoke-host.ts 'C:\path\to\copilot.exe'
```

The smoke uses temporary storage and an experimental extension launch provider. It has passed against Copilot 1.0.105 (protocol 3), including project discovery, canvas open, HTTP response, `get_profile`, and close. The runtime may make startup network calls. This does **not** verify the Copilot app's right-hand panel; the recorded UI evidence covers the actual renderer in Chromium.

Build output is included under `.github\extensions\bud` so the canvas does not require installing runtime packages. Rebuild whenever source/content changes. `evidence\` contains local-only recordings and is ignored by Git.

## Reset or back up

Close Bud canvases and stop the development harness before manipulating storage. Back up the entire Bud data directory, including SQLite WAL/SHM files if present. To reset, move that directory aside while Bud is stopped. Never remove or edit Copilot's own databases to reset Bud.

## Layout

- `src\core`: progress, questions, inventory, and achievement rules.
- `src\adapters\copilot.ts`: read-only current-session JSONL normalization.
- `src\store.ts`: transactional local persistence.
- `src\server.ts`, `src\ui`: protected loopback canvas renderer.
- `src\extension.ts`: host lifecycle and agent-callable actions.
- `content`: verified learning bank.
- `tests`: synthetic unit/integration coverage.
- `SPIKE_REPORT.md`, `DELEGATION_LOG.md`: research provenance and model delegation.
