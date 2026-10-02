# Figma Implementation

Implement a page or component from Figma design. Follow the UI-first workflow.

## Inputs
- Figma URL or node reference
- Target page/component name

## Workflow

1. **Fetch Design**: Use Figma MCP (`get_design_context`, `get_screenshot`) to understand the design.

2. **Inventory Check**: Review existing components in `app/components/` — reuse before creating new. Check PrimeVue MCP for appropriate components.

3. **Build UI**: Create the page/component with hardcoded mock data in `ref()`. Use PrimeVue components exclusively. Apply design tokens from the preset system (`--p-*` variables).

4. **Adapt Design Output**: Figma MCP returns React+Tailwind hints — translate to Vue 3 `<script setup>` + PrimeVue + scoped CSS with design tokens. Never copy Figma output verbatim.

5. **Pattern Review**: Before finishing, check for patterns that appear 2+ times. Extract to shared components or `main.css` if needed.

## Rules
- No raw HTML elements — use PrimeVue
- No raw CSS values — use design tokens
- No inline styles — use `<style scoped>`
- Mock data in page `<script setup>`, never in components
- Page files go flat in `app/pages/` (PascalCase)
