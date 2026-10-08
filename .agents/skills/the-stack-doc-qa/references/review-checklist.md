# Documentation Review Checklist

## Blocking checks

### Technical correctness

- Claims match the cited evidence and applicable version.
- Commands, configuration, dependencies, and examples are internally consistent.
- Failure modes, prerequisites, and safety constraints are not omitted.
- Deprecated, preview, or vendor-specific behavior is labeled.
- Security-sensitive advice does not encourage credential exposure or destructive operations.

### Reader outcome

- The page answers a clear question or enables a specific outcome.
- The assumed reader knowledge is sufficient to follow the content.
- The content mode fits the reader's need and does not mix unrelated modes.
- The ordering supports the reader's decisions and actions.

### Site integrity

- Internal links and image paths resolve.
- Navigation and sidebar entries match the intended route.
- Public assets are present and use appropriate alt text.
- `npm run build` succeeds after relevant changes.

## Quality checks

### Structure

- One H1 with continuous, descriptive heading levels.
- Headings predict their content and use parallel structure where appropriate.
- Sections have a clear purpose and no redundant loops.
- Long content is split at meaningful conceptual or task boundaries.

### Language

- Natural Chinese with concrete subjects and direct wording.
- Consistent terms and defined acronyms.
- No promotional tone, vague superlatives, translation artifacts, or distracting metaphors.
- Conclusions include conditions and trade-offs.

### Evidence

- Primary sources are preferred and actually inspected.
- Version and applicability are visible where needed.
- Facts, inference, and opinion are distinguishable.
- Unresolved conflicts are not hidden.

### Accessibility

- Informative images have useful alt text.
- Meaningful information is not image-only or color-only.
- Links are descriptive outside their surrounding sentence.
- Code and terminal output remain selectable text.
- Semantic lists, tables, and headings are used appropriately.

### Deep quality

- The document has a coherent flow and appropriate information density.
- Background does not interrupt tasks unnecessarily.
- Likely questions are answered at the point of need.
- The text feels deliberate, composed, and useful rather than merely complete.

## Repository checks

- Build commands used are recorded.
- `fix-links.py` is not used as a general link checker.
- Changes remain within the requested documentation scope.
- No unrelated formatting churn is introduced.
- No commit, merge, or deployment is performed without explicit authorization.

