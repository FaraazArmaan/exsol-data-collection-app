# /spec — Workflow specifications

This directory holds **human-authored** HTML specifications describing how the ExSol Data Collection App is structured and how it works end-to-end. It exists separately from `/docs/` (which contains AI-assisted planning artifacts such as ADRs, the PRD, the grilling log, and session handoffs) to make the source of authority unambiguous.

## Rule of authorship

- **`/spec/` files are the canonical specification.** If a `/spec/` file and a `/docs/` file disagree, `/spec/` wins. Update `/docs/` to match.
- **`/spec/` files are written or edited by Faraaz**, possibly with AI assistance for first drafts. They are not generated as a side-effect of a chat session and they do not chronicle conversations.
- **`/docs/` files are AI-assisted artifacts** — outputs of design or grilling sessions, ADRs explaining a decision at a point in time, session handoffs. They are useful history, not authoritative specification.

## File structure

```
spec/
├── README.md           This file. Rules and layout.
├── style.css           Shared minimal print-style stylesheet.
├── index.html          Master end-to-end rundown. Concise (~one screen).
├── 001-data-model.html First addendum. Entity model, relationships.
├── 002-…html           Subsequent addenda as the project evolves.
└── …
```

## Conventions

- **One topic per addendum file.** Don't grow `index.html`; create a new numbered file when a topic deserves its own page.
- **Numbered prefixes (`001-`, `002-`, …) preserve chronological order** of when an addendum was added, not topic priority. Renumbering after the fact is discouraged.
- **Plain HTML5 only.** No build step, no JavaScript. The shared `style.css` provides readable defaults; addenda link to it via `<link rel="stylesheet" href="style.css">`.
- **Keep each file short.** If an HTML doc exceeds two screens of content, split it into multiple addenda.

## When to update

- Update `index.html` when the *core concept* of the project changes (e.g., a new actor role is introduced, the topology shifts).
- Add a new numbered addendum for any concrete addition (a new module, a new workflow, a new integration, a revised data structure).
- Do not delete addenda. Mark them as superseded by adding a `<aside class="superseded">` block at the top linking to the replacement.
