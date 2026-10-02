# Plan Manager

Create a comprehensive, review-ready plan for a task. This plan is NOT for implementation — it is for review and will be audited by another LLM.

## Instructions

When the user describes a task they want to plan:

1. **Gather all relevant context** before writing the plan:
   - Read all `.claude/rules/*.md` files that are relevant to the task
   - Read `CLAUDE.md` for architecture and conventions
   - Read the memory index at `~/.claude/projects/-home-rxe-datasync-liberty-connect/memory/MEMORY.md` and any relevant memory files
   - Read any source files, components, pages, stores, composables, or utilities that the task will touch or depend on
   - Query MCP servers as needed:
     - **PrimeVue MCP** — component APIs, props, slots, events for any UI components involved
     - **Directus MCP** — collection schemas, fields, relations for any data the task involves
     - **Nuxt MCP** — framework features, routing, composables if relevant
   - Read `app/assets/css/main.css` if the task involves styling or shared CSS patterns
   - Read `app/presets/extend.js`, `primitive.js`, `semantic.js`, `components.js` if the task involves tokens or theming
   - Read `nuxt.config.js` if the task involves routing, modules, or configuration

2. **Ask clarifying questions** if the task description is ambiguous or missing critical details. Do not assume — confirm with the user.

3. **Write the plan** with the following structure (all four sections are required):

```markdown
# Plan: [Task Title]

**Created:** [YYYY-MM-DD]
**Status:** Draft — Pending Review
**Task:** [One-line summary of what this plan covers]

---

## High Level Plan

[2-4 paragraphs describing the overall approach, architectural decisions, and rationale. Explain WHAT will be done and WHY this approach was chosen over alternatives. Reference existing patterns and conventions from the codebase.]

## Low Level Description

[Detailed technical breakdown of each part of the plan. Describe the specific files, components, data structures, APIs, and interactions involved. Include expected data shapes from Directus, component prop/slot usage from PrimeVue, and any state management considerations. This section should give a reviewer full understanding of the technical details without needing to read the code.]

## Specific Actions

1. [First concrete action — e.g., "Create `app/pages/PageName.vue` with PascalCase filename"]
2. [Second action — be specific about file paths, component names, prop values]
3. [Continue numbering each discrete action...]
4. [Include route registration, nav updates, store changes, CSS extraction — everything needed]
5. [Each action should be independently verifiable by a reviewer]

## Possible Blockers

- [Blocker 1 — e.g., "Directus schema may not have `field_name` — verify via MCP before implementation"]
- [Blocker 2 — e.g., "PrimeVue DataTable virtual scroll may conflict with frozen columns"]
- [Blocker 3 — dependencies, missing tokens, unclear design specs, API limitations, etc.]
```

4. **Save the plan** to `.claude/plans/[descriptive-kebab-case-name].md`
   - Use a descriptive filename based on the task (e.g., `customer-list-page.md`, `auth-flow-refactor.md`)
   - Never overwrite an existing plan without asking first

5. **Report to the user**: Confirm the plan was saved, display the filename, and remind them it is ready for review.

## Rules

- Do NOT implement anything — this skill is strictly for planning
- Do NOT create, edit, or modify any source files (pages, components, stores, etc.)
- DO read as many relevant files as needed to produce an accurate, grounded plan
- DO query MCP servers to verify assumptions about component APIs, schemas, and framework behavior
- Every claim in the plan must be backed by something you read — no guessing
- Reference specific files, line numbers, token names, and component props where applicable
- Flag uncertainty explicitly in the Possible Blockers section rather than making assumptions
- The plan must be detailed enough that a different developer (or LLM) could implement it without additional context
