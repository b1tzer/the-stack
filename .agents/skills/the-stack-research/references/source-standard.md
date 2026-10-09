# Source and Evidence Standard

## Select sources for the claim

Different claims require different authority:

- Language behavior: specification, compiler or runtime documentation, and reproducible tests.
- Framework behavior: official reference documentation, source, tests, and release notes.
- Database behavior: official manuals, parameter references, release notes, and reproducible diagnostics.
- Architectural practice: primary engineering publications and documented production experience.
- Product selection: official capabilities, constraints, pricing statements, and dated comparisons.
- Historical claims: primary archives and contemporaneous documentation.

A high-quality domain blog may explain a mechanism well, but it cannot override a newer specification or observed behavior.

## Source evaluation

Before using a source, check:

- Authority: who published it and what direct access did they have?
- Proximity: is it primary evidence or commentary?
- Currency: which version and date does it describe?
- Scope: which platform, edition, deployment mode, or configuration is assumed?
- Transparency: are commands, assumptions, and evidence shown?
- Independence: is the comparison materially sponsored or selective?
- Reproducibility: can the important behavior be tested or traced?

## Handle conflicts

1. Confirm that both sources describe the same version, mode, and conditions.
2. Prefer the more primary and more current source for that scope.
3. If behavior changed, write a version transition instead of flattening the history.
4. If sources remain contradictory, mark the claim unresolved and state the conflict.
5. Do not hide uncertainty behind phrases such as generally, usually, or best practice without defining the basis.

## Research output

Use this compact structure:

```text
Question:
Finding:
Evidence:
Applicability:
Confidence:
Document impact:
Remaining uncertainty:
```

For multiple findings, repeat only the finding, evidence, applicability, and impact fields.

## Citation quality

- Link the exact page or section that supports the claim.
- Prefer stable canonical URLs.
- Include version and retrieval date for rapidly changing product documentation.
- Do not cite a search-results page.
- Do not include sources that do not materially support the conclusion.

