# Documentation Quality Standard

This reference defines the quality bar for substantial documentation work in The Stack. It combines functional quality requirements with Diátaxis-informed content design and established technical-writing practice.

## Functional quality

Functional quality is the minimum gate. A document must be:

- Accurate: claims match the real system, specification, or observed behavior.
- Complete enough for the stated reader and task: no hidden prerequisite or missing failure case.
- Consistent: terminology, examples, diagrams, and conclusions agree.
- Useful: the content helps the reader make a decision, build understanding, or complete work.
- Precise: scope and conditions are explicit; uncertainty is visible.
- Maintainable: sources and versions are traceable, and content can be updated without reconstructing the author's intent.

Functional quality is not a substitute for good writing. Accurate documentation can still be awkward, dense, or unhelpful.

## Content modes

### Tutorial

Primary need: learning through guided action.

- The reader should succeed by following the lesson.
- The author is responsible for safe, predictable steps and meaningful outcomes.
- Minimize distracting theory and optional branches.
- Explain only what is necessary to continue, then link to deeper material.
- The title should promise a concrete learning experience or result.

### How-to guide

Primary need: applying skill to a real goal or problem.

- Assume a competent reader who needs directions, not a lesson.
- Organize around the task and its decisions.
- State prerequisites, steps, outcomes, and recovery from likely failures.
- Keep the shortest accessible path primary; document alternatives separately when they matter.
- Do not interrupt the procedure with unrelated background.

### Reference

Primary need: looking up reliable facts during work.

- Be accurate, complete, neutral, and easy to scan.
- Describe the subject's structure faithfully.
- Keep interpretation and instructional narrative out of the lookup material.
- Make scope, defaults, constraints, compatibility, and error conditions explicit.
- Make parallel items structurally parallel.

### Explanation

Primary need: understanding context, mechanisms, and trade-offs.

- Answer why and how things fit together.
- Develop a mental model and connect the subject to a larger picture.
- Perspective and reasoned judgment are allowed when clearly identified.
- Remove procedural steps that belong in a how-to guide.
- Remove exhaustive lookup data that belongs in reference material.

## Content design

Use Diátaxis's two dimensions to classify ambiguous content:

| Content informs | Reader is acquiring skill | Reader is applying skill |
| --- | --- | --- |
| Action | Tutorial | How-to guide |
| Cognition | Explanation | Reference |

Do not force every page into the same section template. A good structure follows the reader's questions, decisions, and likely misconceptions.

## Language quality

- Use direct, conversational technical Chinese.
- Prefer concrete subjects and verbs over nominalizations and abstract wording.
- Keep sentences short enough to follow without repeated parsing.
- Define jargon, acronyms, and overloaded product terms.
- Replace subjective labels such as simple, fast, safe, or best with measurable conditions or explicit comparisons.
- Avoid idioms, cultural assumptions, gendered defaults, ableist language, violent metaphors, and exaggerated claims.
- Use one term for one concept and one concept for one term.

## Heading quality

- Every page has one unique H1.
- Heading levels describe hierarchy and never skip levels.
- Task headings start from the action the reader performs.
- Concept headings name the idea or object being explained.
- Headings are specific enough to support navigation and search.
- Adjacent headings with parallel roles use parallel grammar.
- Do not put dense qualification or multiple questions into a heading.

## Evidence and versions

- Prefer specifications, official product documentation, source code, release notes, and primary engineering publications.
- Treat search snippets and secondary articles as discovery leads, not proof.
- Record source URL, relevant version, and research date for claims that evolve.
- Verify commands and configurations in the stated environment whenever practical.
- Label experimental, deprecated, preview, or vendor-specific behavior.
- When sources conflict, explain the conflict or narrow the claim instead of silently choosing one.

## Examples and procedures

- Start from a stated goal and prerequisites.
- Make each procedure step perform one primary action.
- Show expected results after actions when the reader needs confirmation.
- Include realistic inputs and outputs, but remove secrets and irrelevant noise.
- Show error handling or exit criteria for high-risk workflows.
- Keep examples internally consistent and runnable.
- Link to a repeated procedure instead of copying it.

## Accessibility

- Provide meaningful alternative text for informative images.
- Use empty alternative text for purely decorative images.
- Do not place essential information only in images, color, or styling.
- Do not use screenshots or images for code, terminal output, or long text.
- Use descriptive links that make sense when read out of context.
- Preserve semantic heading, list, table, and code structure.
- Prefer SVG for diagrams that need to remain sharp and searchable or editable.

## Deep quality

After functional quality passes, judge the reading experience:

- Flow: transitions follow the reader's current purpose.
- Fit: content matches the reader's expertise and goal.
- Anticipation: likely questions and failure points are addressed at the right moment.
- Density: every paragraph earns its place.
- Confidence: uncertainty and trade-offs are visible without making the text hesitant.
- Satisfaction: the document feels composed, deliberate, and pleasant to use.

Deep quality requires human judgment. A checklist cannot create it, but the checklist can remove defects that prevent readers from experiencing it.

## Sources

- Diátaxis: https://diataxis.fr/
- Diátaxis quality: https://diataxis.fr/quality/
- Google Developer Documentation Style Guide: https://developers.google.com/style
- Google headings and titles: https://developers.google.com/style/headings
- Google procedures: https://developers.google.com/style/procedures
- Google accessible documentation: https://developers.google.com/style/accessibility
- Google inclusive documentation: https://developers.google.com/style/inclusive-documentation
- Microsoft Writing Style Guide: https://learn.microsoft.com/style-guide/welcome/

