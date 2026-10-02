import type { InjectionKey } from 'vue'

/**
 * CONNECT-574 — collapsible filter sections.
 *
 * On short viewport heights the "Filter By" panel can grow taller than the
 * screen and clip its lowest sections (e.g. "National Customers only" gets cut
 * off and becomes unreachable). Sections are ordered by importance, so when the
 * panel overflows we auto-collapse them from the bottom up until it fits —
 * keeping as many high-priority sections open as possible. A chevron on each
 * collapsible section also lets the user open/close it manually.
 *
 * The toolbar owns the controller and provides it; each collapsible
 * `BaseFilterSection` injects it and registers a handle.
 */

export interface FilterSectionHandle {
  collapse: () => void
  expand: () => void
  readonly el: HTMLElement | null
}

export interface FilterCollapseController {
  register: (handle: FilterSectionHandle) => void
  unregister: (handle: FilterSectionHandle) => void
  /** A section reports a manual chevron click so an in-flight auto-fit backs off. */
  notifyManualToggle: () => void
}

export const FILTER_COLLAPSE_KEY = Symbol('filterCollapse') as InjectionKey<FilterCollapseController>

// Gap to preserve between the panel's bottom edge and the viewport bottom.
const VIEWPORT_MARGIN_PX = 16

export function useFilterCollapse() {
  const sections = new Set<FilterSectionHandle>()
  let userToggled = false

  const controller: FilterCollapseController = {
    register: (handle) => { sections.add(handle) },
    unregister: (handle) => { sections.delete(handle) },
    notifyManualToggle: () => { userToggled = true },
  }

  // Registered sections in document order (top = highest priority).
  function orderedSections(): FilterSectionHandle[] {
    return [...sections]
      .filter((section): section is FilterSectionHandle & { el: HTMLElement } => !!section.el)
      .sort((first, second) =>
        first.el.compareDocumentPosition(second.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
  }

  function isOverflowing(panelBody: HTMLElement): boolean {
    const rect = panelBody.getBoundingClientRect()
    const availableHeight = window.innerHeight - rect.top - VIEWPORT_MARGIN_PX
    return panelBody.scrollHeight > availableHeight
  }

  // Re-expand everything (so a resize that frees space re-opens sections), then
  // collapse from the bottom until the panel fits. `getPanelBody` is resolved
  // lazily because the popover/inline panel mounts only once it opens.
  async function reflow(getPanelBody: () => HTMLElement | null) {
    const ordered = orderedSections()
    if (!ordered.length) { return }

    userToggled = false
    ordered.forEach((section) => section.expand())
    await nextTick()

    const panelBody = getPanelBody()
    if (!panelBody) { return }

    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      // The user grabbed the wheel mid-fit — respect their choice and stop.
      if (userToggled) { break }
      if (!isOverflowing(panelBody)) { break }
      ordered[index].collapse()
      await nextTick()
    }
  }

  return { controller, reflow }
}
