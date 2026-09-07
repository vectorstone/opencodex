# 000 — Authoritative max-output metadata for client exports

Unit: `devlog/_plan/260826_max_output_token_metadata/`
Opened: 2026-08-26 · Branch target: `dev`
Baseline: fork `dev` at `a4ed85e68`, after the upstream v2.33.0 merge

## Objective

Replace the client-export-wide `32000` stand-in with authoritative per-model
maximum output-token metadata. A known value must survive the canonical catalog
and management boundaries into every client schema that can represent it. An
unknown value must remain unknown instead of becoming a request-limiting guess.

## Updated v2.33.0 diagnosis

The upstream synchronization did not absorb this repair. The current export core
still defines `SCHEMA_REQUIRED_OUTPUT_BUDGET = 32_000` and derives OpenCode, Pi,
OMP/Prime, and Gajae output limits from `min(32000, contextWindow)`. The current
local catalog therefore still exports `32000` for every configured model whose
context window is at least 32k.

The old proposal needs one important correction after the v2.33.0 audit:

- `OcxProviderConfig.defaultMaxOutputTokens` and `modelMaxOutputTokens` are
  documented request defaults for the OpenAI Chat adapter. They are applied when
  a caller omits a request limit. They are not catalog capability metadata and
  must not be reused by the export path.
- `src/generated/model-metadata.ts` already carries a real `maxTokens` field for
  provider/model pairs backed by an exact metadata bundle.
- User-managed models already have the right ownership surface in
  `OcxCustomModel`; they need an explicit output-capability field rather than a
  second provider request-default interpretation.
- v2.33.0 exports eleven clients, not the smaller set in the original diagnosis:
  OpenCode, Pi, OMP, Hermes, OpenClaw, Kimi, Gajae, DSH, MCode, ZCode, and Prime.

## Semantic contract

Introduce `maxOutputTokens?: number` as capability metadata on
`CatalogModel`, `ManagementModelRow`, and `ExportModel`, and as an explicit
optional field on `OcxCustomModel`. It means the largest output-token budget the
selected model route is known to accept. It does not mean the value opencodex
should inject when a caller omitted its request limit.

Only positive safe integers are valid. Absence means unknown. Zero, negative,
fractional, non-finite, inherited request defaults, and schema placeholders are
not capability evidence.

### Source precedence

1. An explicit `OcxCustomModel.maxOutputTokens` is authoritative for that custom
   route. This is the path for local mixed-vendor gateways such as `GI`, `GIcc`,
   and `global-infra`.
2. A generated metadata row is authoritative only through the provider's exact
   `jawcodeBundle`/metadata alias and exact normalized model id.
3. A custom row replacing an existing provider row inherits that row's
   `maxOutputTokens` only when the custom row did not set its own value.
4. Combo output capability is the minimum member value only when every member
   has a known value. If any target is unknown, the combo value is unknown.
5. Native ChatGPT/Codex rows stay unknown unless their own trusted native source
   gains an output field. Do not borrow the similarly named OpenAI API model's
   generated metadata.

Do not add a cross-provider model-id fallback. A gateway can impose a different
limit from the original vendor, and the same model id is not proof that two
destinations share one output ceiling. Do not serialize an invented field into
Codex's raw catalog or `models_cache.json`; this capability is for opencodex's
in-memory catalog, management API, and client exports.

## Client serialization matrix

| Client | Known context + known output | Output unknown | Notes |
|---|---|---|---|
| OpenCode | Emit `limit: { context, output }` | Omit the entire `limit` block | Its schema requires context/output as a pair. |
| Pi | Emit `contextWindow` and `maxTokens` independently | Preserve known context; omit `maxTokens` | No 32k fallback. |
| OMP | Same as Pi | Same as Pi | This removes the accidental real request cap. |
| Prime | Same as Pi | Same as Pi | It reuses the Pi builder. |
| Gajae | Emit supported fields independently | Preserve known context; omit `maxTokens` | Keep the strict-schema allowlist. |
| ZCode | Emit `limit.context`; add optional `limit.output` when known | Keep context-only `limit` | v2.33.0 already models `output` as optional. |
| Hermes | Unchanged | Unchanged | Model-id list only. |
| OpenClaw | Unchanged | Unchanged | No verified output field in the owned schema. |
| Kimi | Unchanged | Unchanged | Owned field is mandatory `max_context_size`, not output. |
| DSH | Unchanged | Unchanged | Current verified model schema has context and reasoning only. |
| MCode | Unchanged | Unchanged | Current verified limit schema has context only. |

When both values exist, serializers defensively emit
`min(maxOutputTokens, contextWindow)`. The catalog retains the source value so a
context-window cap does not silently rewrite the underlying capability fact.

## Implementation phases

### Phase 1 — canonical metadata and custom-model ownership

- Add `maxOutputTokens?: number` to `OcxCustomModel` and `CatalogModel`.
- Validate custom-model POST/PATCH values as positive safe integers; `null` on
  PATCH clears the explicit value. Preserve existing config compatibility.
- Extend the Models dashboard custom-model add/edit form and read model rows to
  display and edit the value. Update GUI API types and all maintained locales.
- In provider catalog derivation, copy exact generated `meta.maxTokens` into a
  model's `maxOutputTokens`. Include it in jawcode augmentation rows and cached
  config-hint application.
- Preserve explicit custom values, gap-fill from a replaced provider row, and
  derive combo minima only when all members are known. Include the field in
  catalog signatures that detect semantic drift.

### Phase 2 — management boundary and export core

- Carry `maxOutputTokens` through `/api/models`, `toExportModel`, CLI export,
  management client-config, and integration writers.
- Remove `SCHEMA_REQUIRED_OUTPUT_BUDGET` and `outputBudgetFor`; replace them with
  validation/clamping of the optional authoritative value.
- Implement the client matrix above. Re-define each serializer's
  `modelsWithoutLimits` summary against the fields that client actually received
  and update the GUI wording if the current label would misdescribe partial
  metadata.
- Keep ordering, visibility filtering, secret handling, and byte identity across
  CLI/API/integration surfaces unchanged.

### Phase 3 — documentation and fork contract

- Update the English Pi and OpenCode guides and every maintained translation
  that currently describes `32000` as a schema stand-in. Document unknown-value
  behavior and the custom-model configuration field.
- Add a stable fork delta entry (next available `F-NNN`) to `AGENTS.md`: known
  output capabilities are exported; unknown values never become `32000`; request
  defaults remain separate and must never leak into catalog capability metadata.
- Name the focused regression tests in that register so the behavior survives
  future upstream synchronization.

### Phase 4 — local configuration and operational proof

- After the implementation lands, set `maxOutputTokens` on the local `GI`,
  `GIcc`, and `global-infra` custom-model rows only from destination-specific
  evidence. Generated vendor metadata may be used as an investigation lead, not
  auto-applied across the gateway boundary. Models such as `codex-auto-review`
  and `kimi-k3` remain unset until their serving endpoint is verified.
- Re-export all enabled clients and inspect representative known and unknown
  rows. Confirm OMP and OpenCode no longer show a uniform 32k cap.
- Send bounded representative requests through an output-capable model and an
  unknown model to distinguish configuration correctness from actual provider
  behavior. Do not claim the full model maximum from a short successful request.

## Regression matrix

Focused tests should cover at least:

- generated metadata reaches `CatalogModel.maxOutputTokens`; absent metadata
  remains absent; no provider request-default field is consulted;
- custom model create/update/clear, custom-over-provider precedence, inheritance,
  and config round-trip;
- combo all-known minimum and any-unknown omission;
- `/api/models` and `ExportModel` propagation;
- OpenCode known pair versus unknown output, Pi/OMP/Prime/Gajae independent
  fields, and ZCode optional output;
- all other client documents remain byte-stable except for fixtures that now
  receive the new authoritative field;
- no client export serializes a real key; disabled rows stay absent; stable
  ordering/deduplication remains intact;
- GUI custom-model form and API payload coverage.

Expected focused files include `tests/codex-catalog.test.ts`,
`tests/client-config-export.test.ts`,
`tests/client-config-new-clients.test.ts`,
`tests/management-client-config-route.test.ts`, custom-model management tests,
CLI export tests, and the relevant GUI model tests.

Because this touches shared config, catalog derivation, management server
behavior, GUI, and a fork-maintained contract, completion requires the focused
tests plus `bun run typecheck`, `bun run test`, `bun run privacy:scan`,
`bun run lint:gui`, `bun run build:gui`, the relevant GUI test suite, and the
documentation build. A review-ready GUI PR also needs the template-required
screenshot.

## Acceptance

The unit is done when:

1. No production export path contains the 32k stand-in.
2. A known custom or exact-bundle value reaches every compatible client schema.
3. Unknown output capability stays omitted and never limits requests by guess.
4. Provider request defaults retain their existing adapter-only semantics.
5. The local mixed-vendor custom models can be configured explicitly without
   hard-coding private provider facts into the repository.
6. The full required validation is green and the fork delta register documents
   the surviving behavior.

## Status

Implemented against the synchronized v2.33.0 tree on 2026-08-26: canonical metadata, custom-model
configuration and CLI/GUI controls, management/export propagation, client-specific omission rules,
tests, documentation, and fork register F-004 are present in the working tree. Focused runtime and
GUI tests, typecheck, privacy scan, GUI lint/build, and docs build pass.
The implementation commit is `6272fc3f4`.

The repository-wide Bun 1.4 single-process suite completed with 14,692 passes, 11 skips, and 18
failures. The first failure is the pre-existing `key-login-live-update.test.ts` `modelCosts` live
overlay defect recorded by the prior upstream-sync work. The remaining failures are provider POST
400s, one WebSocket timeout, and one retained-root serialization timeout; the provider file still
reproduces its 400s in isolation, while the WebSocket case passes in isolation. None of those tests
touches the max-output implementation, and every focused max-output test passes.

The local `GI`, `GIcc`, and `global-infra` custom rows remain intentionally unmodified until their
destination-specific output limits are verified. Source-run exports now omit the false uniform 32k
limit: all 19 OMP rows retain context and omit `maxTokens`, while all 19 OpenCode rows omit the
paired `limit` block.
