---
name: the-stack-doc-authoring
description: Draft and revise Chinese technical documentation for The Stack using audience-centered, evidence-based, Diátaxis-informed quality standards. Use for new articles, major rewrites, restructuring, and wording improvements that change how readers understand or use the material.
---

# The Stack Documentation Authoring

Create documentation that is correct, useful, natural to read, and maintainable. Do not imitate existing project prose merely because it is already present.

For small edits, apply the constraints below directly. Before a new article or major rewrite, read `references/quality-standard.md`.

## Establish the writing task

1. Identify the reader's prior knowledge, immediate goal, and desired outcome.
2. Choose one dominant content mode:
   - Tutorial: guided learning and confidence-building.
   - How-to guide: help a competent reader achieve a real task.
   - Reference: accurate, neutral facts organized like the described system.
   - Explanation: context, mental models, trade-offs, and answers to why.
3. State the single core question the page answers. Split or link content that serves a materially different question.
4. Choose structure from the reader's decisions and likely confusion, not from a universal section template.

## Research dependencies

When accuracy, current behavior, version compatibility, comparisons, or external claims matter, use `the-stack-research` before drafting. It searches `~/projects/source/tech-knowledge` first and uses online sources only when local evidence is absent or insufficient. Do not resolve uncertain technical claims from memory or from existing project prose.

## Write for function and experience

- Lead with the answer or useful orientation; defer nonessential history.
- Use natural Chinese, concrete subjects, active constructions, and short complete sentences.
- Use precise industry terms consistently and define them at first use.
- Separate established facts, reasoned inference, trade-offs, and recommendations.
- Describe conditions, failure modes, and consequences. Do not reduce content to feature lists.
- Prefer one meaningful example with context over several disconnected snippets.
- Remove repetition, promotional language, vague intensifiers, idioms, and decorative metaphors.
- Preserve reader flow. Link to deep background instead of interrupting a task with extended theory.

## Structure and accessibility

- Use exactly one H1 and a descriptive, continuous heading hierarchy.
- Use action-oriented headings for tasks and clear noun phrases for concepts.
- Keep headings unique and parallel where they serve parallel content.
- Provide text equivalents for meaningful diagrams.
- Give every image useful alt text; use empty alt text only for decoration.
- Use meaningful link text and semantic lists, tables, and code blocks.
- Keep code and terminal output as text, with enough context to understand input, output, and errors.

## Finish the work

- Verify every technical claim and example that could mislead the reader.
- Check terminology, scope, version assumptions, internal links, assets, and navigation.
- Run `npm run build` after content or site integration changes.
- Review the final diff for both factual defects and poor reading experience.
- Summarize what changed and call out any unresolved uncertainty.

