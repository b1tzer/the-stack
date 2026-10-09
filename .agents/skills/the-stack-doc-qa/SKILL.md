---
name: the-stack-doc-qa
description: Review and validate The Stack documentation changes for factual defects, reader fit, structure, accessibility, links, site integration, and VitePress build health. Use before accepting substantive document or navigation changes.
---

# The Stack Documentation QA

Review defect-first. Identify concrete failures before suggesting stylistic preferences. Distinguish blocking issues from optional improvements and state the affected file and location.

Read `references/review-checklist.md` for the complete review checklist.

## Review scope

1. Determine the intended reader, task, and dominant content mode.
2. Review only the changed content and its direct dependencies, including navigation, links, diagrams, and examples.
3. Verify technical claims when the change introduces or alters them. Use `the-stack-research` when external evidence is required.
4. Inspect the final diff for contradictions, missing prerequisites, stale version statements, and misleading examples.
5. Run `npm run build` when Markdown, configuration, themes, or public assets changed.

## Defect classes

- Critical: unsafe instructions, materially false claims, secrets, or examples that can corrupt data.
- High: broken build, missing prerequisites, version mismatches, misleading conclusions, or broken navigation.
- Medium: unclear structure, inaccessible content, broken internal links, inconsistent terminology, or unverifiable examples.
- Low: minor wording, formatting, and discoverability improvements.

## Review dimensions

- Functional quality: accuracy, completeness, consistency, usefulness, and precision.
- Content fit: correct tutorial, how-to, reference, or explanation mode and coherent reader flow.
- Language: natural Chinese, concrete phrasing, terminology, headings, and information density.
- Evidence: source quality, version scope, and uncertainty handling.
- Accessibility: alt text, meaningful links, heading hierarchy, and text equivalents.
- Site integration: route shape, sidebar or navigation entry, assets, and VitePress rendering.
- Verification: examples and commands where practical, then the repository build.

## Output

Return findings ordered by severity. For each finding include:

- File and location.
- What is wrong.
- Why it matters to the reader or site.
- A concrete correction direction.

End with:

- Validation commands run and results.
- Residual risks or unverified claims.
- A short conclusion: ready, ready after fixes, or not ready.

Do not rewrite the entire document in review output unless explicitly requested.

