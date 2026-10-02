# PrimeVue Usage

## 100% PrimeVue — No Raw HTML Interactive Elements

| Instead of | Use |
|---|---|
| `<button>` | `Button` |
| `<input>` | `InputText`, `InputNumber`, `InputSwitch`, `InputGroup` |
| `<select>` | `Select` |
| `<textarea>` | `Textarea` |
| `<table>` | `DataTable` + `Column` |
| `<a>` (navigation) | `NuxtLink` or `BaseBackButton` |
| `<dialog>` | `Dialog` or `Drawer` |
| `<checkbox>` | `Checkbox` |
| `<radio>` | `RadioButton` |

## No Thin Wrappers
Use PrimeVue components directly. Only create `Base*` wrappers when genuinely composing multiple PrimeVue primitives (e.g., `BasePanel` = Panel + Button + Divider + slots).

## DataTable Patterns
- Use `Column` with `field`, `header`, and `style` props
- `Column` `style` prop is the only acceptable inline style (framework-idiomatic for column widths)
- Status columns use `Tag` component with severity or custom class
- Frozen columns via `frozen` prop on `Column`

## Status Tags
- Active: `.status-active` with green background
- Inactive: `.status-inactive` with red background
- Use `Tag` component with appropriate severity or custom styling

## Styling
For the PrimeVue override hierarchy and all CSS rules, see `03-css-tokens.md`.

## MCP Server
Always check the PrimeVue MCP server (`get_component`, `get_component_props`, `get_component_slots`, `suggest_component`) before guessing component APIs.
