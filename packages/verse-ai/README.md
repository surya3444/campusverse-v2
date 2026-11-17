# @campusverse/verse-ai

The Verse AI mechanism (spec: `docs/specs/VERSE_AI.md`). No database: the `platform/verse` module owns the log, budget and switch, and each module defines its own tools.

- **`defineTool`**: name (`module.resource.action`), description, `permission` (any of; `null` for public help), `risk` (`read` or `draft`), `dataClasses`, a Zod `input`, and a handler that calls the module's ordinary use case with the asking person as actor.
- **`selectTools`**: offers a tool only when the person holds one of its permissions, and never a tool whose data classes go beyond `public` and `operational` (`MODEL_SAFE`) until personal data is cleared for model use.
- **`runGateway`**: the manual tool loop. A call to a tool that wasn't offered, invalid input, a permission denial or a failure goes back to the model as an error result; tool output is scrubbed (phones, emails, 12-digit identifiers) and fenced as `<tool_output>` data. Up to four steps; refusals and `max_tokens` stop it.
- **Models**: `claudeModel` (Anthropic API, `claude-opus-5-5` by default, low effort, prompt caching, server-side refusal fallbacks via `fallbacks: 'default'`); `localModel` (offline keyword stand-in for development without a key; sends nothing); `scriptedModel` + `turn` for tests.
- **`helpSearch`**: how-to articles linked to screens.

Tests: `src/*.test.ts` (unit); the exit check and live evaluations are in `apps/api/tests/verse*.db.test.ts`.
