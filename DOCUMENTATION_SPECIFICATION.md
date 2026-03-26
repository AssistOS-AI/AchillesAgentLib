# Documentation Specification

This file defines how future documentation pages in this repository should be written, revised, and structured. Its purpose is to prevent unsupported claims, reduce stylistic drift, and avoid re-learning the same documentation rules from zero each time a page is updated.

## 1. Primary Principle

Documentation must be written for human readers, not for another model. The text should explain what exists, why it exists, and how it behaves in practice. It should not read like prompt scaffolding, product marketing, or generated filler.

## 2. Technical Fidelity

Every substantive claim must be checked against the codebase before it is documented.

- Do not describe behaviors, automation steps, runtime flows, generated files, or APIs unless they are confirmed in the implementation.
- Do not invent architectural layers, lifecycle stages, or validation guarantees because they sound plausible.
- If a statement cannot be confirmed from code, either remove it or narrow it until it becomes defensible.
- If some wording is interpretive rather than directly stated in code, keep the interpretation modest and consistent with the implementation.

## 3. Standard Explanatory Order

For subsystem and skill-family pages, the default reading order should be:

1. Why the subsystem or component is needed.
2. How the architectural solution emerges from that problem.
3. How the subsystem works in practice.

This order should be preferred unless the page is purely reference-oriented.

## 4. Editorial Rules

- Avoid meta text about how to read the page.
- Avoid headings that sound like generated slogans or product copy.
- Preserve the logical order of ideas without repeating the same heading formula across pages. The documentation may repeatedly follow a `problem -> architectural response -> practical operation` structure, but chapter titles should be adapted naturally to the subject of the page rather than mechanically repeating forms such as `Why ...`, `How ...`, or other obvious templates.
- When a canonical architectural document already exists for the same topic, reuse its vocabulary and abstraction level where this is compatible with the code. Documentation pages should not invent a parallel terminology if the project already uses a stable language in reports or architecture texts.
- Prefer a small number of substantial chapters over many short fragments.
- Keep explanatory text in prose, with complete sentences and clear argumentative flow.
- Use lists only when the content is genuinely list-shaped.
- Avoid unexplained abbreviations in general explanatory prose.
- Keep code identifiers, filenames, module names, and exact technical terms unchanged.

## 5. What Good Structure Looks Like

A typical strong subsystem page should do the following:

1. Explain the operational pain point.
2. Show why unconstrained behavior is insufficient.
3. Introduce the structural or architectural response.
4. Explain the real execution path with actual files and modules.
5. Clarify maintenance and testing responsibilities when relevant.

The page should not begin with implementation trivia before the reader understands the reason the subsystem exists.

## 6. Subpages

Subpages should be created only when the topic naturally contains distinct layers that would overload a single page.

Examples of valid splits:

- overview
- authoring
- runtime
- testing
- reference

Another valid split appears when one runtime concept has multiple execution regimes with materially different contracts. In that case, prefer:

- overview
- one subpage per execution regime

This pattern is justified only when the reader benefits from understanding both the common contract and the regime-specific differences without overloading one page.

Do not create subpages merely to make the documentation seem more structured.

## 7. Sidebar Navigation

Sidebar navigation should be added only for a real family of related pages.

- Use a sidebar when a topic has multiple companion pages that readers may need to switch between directly.
- A hub or overview page may also use a sidebar as a shortcut menu to related pages, but in that case it must be clearly labeled as shortcuts or related skill families, not as chapters or subpages of the current page.
- Do not use a sidebar for isolated pages.
- Do not repeat the same overview-style shortcut sidebar on every destination page unless those destination pages themselves form a real multi-page family.
- The sidebar must not make the reading column too narrow.
- On smaller screens, the sidebar must collapse above the content in a clean responsive format.

## 8. Examples and Callouts

- Use examples where abstract explanation is insufficient.
- Minimal examples are appropriate for starting templates.
- Extended examples are appropriate when optional behavior needs to be shown in context.
- Callout boxes should be reserved for operationally important information.
- Do not use callouts for purely decorative emphasis.

## 9. Responsive and Visual Rules

- The reading column must remain comfortable on desktop.
- Navigation must not visually compete with the main text.
- Links in prose must remain visibly identifiable without hover.
- Avoid UI patterns that look like application dashboards unless they solve a real documentation problem.
- On mobile and tablet, layouts must collapse before text becomes cramped.

## 10. Working Procedure

For each page:

1. Inspect the relevant code first.
2. Identify only the claims that can be technically supported.
3. Decide whether the page should remain single-page or become a family of pages.
4. Write the page in the order `why -> architectural emergence -> practical operation`.
5. Add exact file/module/runtime details only after they are verified.
6. Remove unsupported, promotional, redundant, or meta-documentation text.
7. Review desktop and mobile readability after structural changes.

## 11. Model for the Current Standard

The current reference model for this documentation style is the DBTable documentation family:

- `docs/dbtable-skills.html`
- `docs/dbtable-skills-authoring.html`
- `docs/dbtable-skills-runtime.html`
- `docs/dbtable-skills-testing.html`

These pages define the current standard for:

- chapter density
- explanatory order
- integration of technical detail
- justified use of subpages
- justified use of sidebar navigation

Future pages should align with that model unless the technical nature of the page clearly requires a different structure.
