# Page metadata

Every content page declares two frontmatter fields: `type` and `level`. They record what the page is for and what it assumes about the reader, so review and navigation do not have to infer either from the prose.

## type

Four values, one per dominant purpose. Judge by what the reader is doing at that moment, not by the topic.

| Value | Reader is | Author's contract |
| --- | --- | --- |
| `tutorial` | learning by following | every step succeeds; the page produces a visible, verifiable result |
| `howto` | solving a real task | assumes competence; states prerequisites, outcome, and recovery |
| `reference` | looking something up | complete, neutral, scannable; no teaching narrative |
| `explanation` | building understanding | answers why; states mechanisms, trade-offs, and boundaries |

Rules:

- One dominant purpose per page. If two purposes each take roughly half the body, split the page.
- No additional values. `overview`, `concept`, `pitfall`, `practice`, and `cheatsheet` are page forms, not types; classify them by dominant purpose using the table below.
- Navigation pages (`index.md`), snippets under `_snippets/`, and dynamically generated blog pages do not carry these fields.

Edge cases:

| Page form | type | Reason |
| --- | --- | --- |
| Chapter overview that only positions other chapters | `explanation` | It builds the mental model for what follows |
| Pitfall page: symptom, cause, fix | `explanation` | The why dominates; the fix is incidental. If the page only lists fixes, use `howto` |
| Configuration or API lookup table | `reference` | The reader needs random access to facts |
| End-to-end scenario that builds a working setup | `howto` | The reader finishes a task |
| Source-code walkthrough | `explanation` | Mechanism, not procedure |
| Migration or upgrade guide | `howto` | The reader must complete the move |

If the page still resists classification, ask which error is worse: a reader who follows it and fails (procedure — `tutorial` or `howto`), quotes it and is wrong (`reference`), or understands it and gets the model wrong (`explanation`).

## level

Three values. `level` states the prior knowledge the page assumes, not how difficult the prose reads.

| Value | Assumes |
| --- | --- |
| `basic` | General programming ability and domain vocabulary; no other page in this section has been read |
| `intermediate` | The core concepts of this subject: the reader knows the terms and the basic model |
| `advanced` | Internal mechanisms, or concepts usually obtained by reading the implementation |

`type` and `level` are independent. `tutorial` with `advanced` is valid, and so is `explanation` with `basic`.

Do not raise `level` because the page is long or detailed. A detailed novice page is still `basic`; a short page that assumes source-level knowledge is `advanced`.

## Frontmatter

```yaml
---
type: explanation
level: intermediate
---
```

Both fields appear together or not at all. Keep existing fields such as `doc_id` and `title` where they are.

## Checks

Implemented in `check-docs.mjs`:

- An unknown `type` or `level` value fails the check.
- Writing only one of the two fields fails the check.
- A content page without both fields is counted and reported per domain as a migration warning. It does not fail the check yet.

The checker does not judge whether a page matches its declared type. That judgment belongs to `review-checklist.md`, where mode mixing is a blocking finding.

## Migration

New pages and substantially rewritten pages must carry both fields from the first commit. Existing pages migrate by domain, highest-value domains first:

1. `java`, `spring`: most read, most cited, and the reference standard for the rest.
2. `mysql`, `redis`, `kafka`, `elasticsearch`, `rabbitmq`, `postgresql`: annotate while performing the scheduled review recorded in `.vitepress/review-status.json`.
3. `design-pattern`, `engineering`, `scenarios`, `ai`: annotate during the next substantive rewrite.

When every content page carries both fields, change the missing-field warning to a failure.
