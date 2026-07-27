/**
 * Local Material Symbols icons, as inline SVG vectors (no web font, no CDN).
 * Each icon keeps its NATIVE `0 -960 960 960` viewBox so its original design —
 * including the built-in padding and true (non-square) aspect ratio — is
 * preserved exactly; the glyph stays centered and undistorted. The ~17% grid
 * padding means the box is rendered slightly larger than the icon font-size
 * (see AppNavIcon.vue) so the visible glyph lands at the design's specified
 * dimensions and optically matches the neighbouring PrimeIcons.
 * Referenced by "ms:<name>" from the sidebar nav manifest (navigation.ts) and
 * from detail-page tab configs; rendered by AppNavIcon.vue.
 */

// All Material Symbols share this native 24dp (0 -960 960 960) drawing grid.
export const MATERIAL_ICON_VIEWBOX = '0 -960 960 960'

// name → SVG path data (original, unedited — only the render size is tuned).
export const MATERIAL_ICON_PATHS: Record<string, string> = {
  // Drawn at a lighter stroke weight than the other glyphs here — that is how
  // the design places it, so the path is transcribed from Figma rather than
  // taken from the wght-400 Material Symbols set.
  checklist: 'M229 -203.5L90.5 -342L143 -394.5L228 -309.5L398 -479.5L450.5 -426L229 -203.5ZM229 -523.5L90.5 -662L143 -714.5L228 -629.5L398 -799.5L450.5 -746L229 -523.5ZM522 -282.5V-357.5H870V-282.5H522ZM522 -602.5V-677.5H870V-602.5H522Z',
  shoppingmode: 'M446 -80C436 -80 426 -82 416 -86C406 -90 397 -96 389 -104L103 -390C95 -398 89.17 -406.83 85.5 -416.5C81.83 -426.17 80 -436 80 -446C80 -456 81.83 -466 85.5 -476C89.17 -486 95 -495 103 -503L455 -856C462.33 -863.33 471 -869.17 481 -873.5C491 -877.83 501.33 -880 512 -880H799C821 -880 839.84 -872.17 855.5 -856.5C871.17 -840.83 879 -822 879 -800V-513C879 -502.33 877 -492.17 873 -482.5C869 -472.83 863.33 -464.33 856 -457L503 -104C495 -96 486 -90 476 -86C466 -82 456 -80 446 -80ZM446 -160L799 -514V-800H513L160 -446L446 -160ZM699 -640C715.67 -640 729.83 -645.83 741.5 -657.5C753.17 -669.17 759 -683.33 759 -700C759 -716.67 753.17 -730.83 741.5 -742.5C729.83 -754.17 715.67 -760 699 -760C682.33 -760 668.17 -754.17 656.5 -742.5C644.83 -730.83 639 -716.67 639 -700C639 -683.33 644.83 -669.17 656.5 -657.5C668.17 -645.83 682.33 -640 699 -640Z',
  conveyor_belt: 'M200 -120C166.67 -120 138.33 -131.66 115 -155C91.67 -178.33 80 -206.67 80 -240C80 -273.33 91.67 -301.67 115 -325C138.33 -348.33 166.67 -360 200 -360H760C793.33 -360 821.66 -348.33 845 -325C868.33 -301.67 880 -273.33 880 -240C880 -206.67 868.33 -178.33 845 -155C821.66 -131.66 793.33 -120 760 -120H200ZM200 -200H760C771.33 -200 780.84 -203.84 788.5 -211.5C796.17 -219.17 800 -228.67 800 -240C800 -251.33 796.17 -260.83 788.5 -268.5C780.84 -276.17 771.33 -280 760 -280H200C188.67 -280 179.17 -276.17 171.5 -268.5C163.83 -260.83 160 -251.33 160 -240C160 -228.67 163.83 -219.17 171.5 -211.5C179.17 -203.84 188.67 -200 200 -200ZM400 -440C388.67 -440 379.17 -443.83 371.5 -451.5C363.83 -459.17 360 -468.67 360 -480V-800C360 -811.33 363.83 -820.83 371.5 -828.5C379.17 -836.17 388.67 -840 400 -840H720C731.33 -840 740.83 -836.17 748.5 -828.5C756.16 -820.83 760 -811.33 760 -800V-480C760 -468.67 756.16 -459.17 748.5 -451.5C740.83 -443.83 731.33 -440 720 -440H400ZM440 -520H680V-760H440V-520ZM80 -522V-599H277V-522H80ZM480 -640H640V-719H480V-640ZM160 -640H277V-719H160V-640Z',
  directions_run: 'M520-40v-240l-84-80-40 176-276-56 16-80 192 40 64-324-72 28v136h-80v-188l158-68q35-15 51.5-19.5T480-720q21 0 39 11t29 29l40 64q26 42 70.5 69T760-520v80q-66 0-123.5-27.5T540-540l-24 120 84 80v300h-80Zm-36.5-723.5Q460-787 460-820t23.5-56.5Q507-900 540-900t56.5 23.5Q620-853 620-820t-23.5 56.5Q573-740 540-740t-56.5-23.5Z',
  barcode_scanner: 'M40-120v-200h80v120h120v80H40Zm680 0v-80h120v-120h80v200H720ZM160-240v-480h80v480h-80Zm120 0v-480h40v480h-40Zm120 0v-480h80v480h-80Zm120 0v-480h120v480H520Zm160 0v-480h40v480h-40Zm80 0v-480h40v480h-40ZM40-640v-200h200v80H120v120H40Zm800 0v-120H720v-80h200v200h-80Z',
  precision_manufacturing: 'M159-120v-120h124L181-574q-27-15-44.5-44T119-680q0-50 35-85t85-35q39 0 69.5 22.5T351-720h128v-40q0-17 11.5-28.5T519-800q9 0 17.5 4t14.5 12l68-64q9-9 21.5-11.5T665-856l156 72q12 6 16.5 17.5T837-744q-6 12-17.5 15.5T797-730l-144-66-94 88v56l94 86 144-66q11-5 23-1t17 15q6 12 1 23t-17 17l-156 74q-12 6-24.5 3.5T619-512l-68-64q-6 6-14.5 11t-17.5 5q-17 0-28.5-11.5T479-600v-40H351q-3 8-6.5 15t-9.5 15l200 370h144v120H159Zm108.5-531.5Q279-663 279-680t-11.5-28.5Q256-720 239-720t-28.5 11.5Q199-697 199-680t11.5 28.5Q222-640 239-640t28.5-11.5ZM365-240h78L271-560h-4l98 320Zm78 0Z',
  request_quote: 'M440-200h80v-40h40q17 0 28.5-11.5T600-280v-120q0-17-11.5-28.5T560-440H440v-40h160v-80h-80v-40h-80v40h-40q-17 0-28.5 11.5T360-520v120q0 17 11.5 28.5T400-360h120v40H360v80h80v40ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-560v-160H240v640h480v-480H520ZM240-800v160-160 640-640Z',
  local_shipping: 'M155-195q-35-35-35-85H40v-440q0-33 23.5-56.5T120-800h560v160h120l120 160v200h-80q0 50-35 85t-85 35q-50 0-85-35t-35-85H360q0 50-35 85t-85 35q-50 0-85-35Zm113.5-56.5Q280-263 280-280t-11.5-28.5Q257-320 240-320t-28.5 11.5Q200-297 200-280t11.5 28.5Q223-240 240-240t28.5-11.5ZM120-360h32q17-18 39-29t49-11q27 0 49 11t39 29h272v-360H120v360Zm628.5 108.5Q760-263 760-280t-11.5-28.5Q737-320 720-320t-28.5 11.5Q680-297 680-280t11.5 28.5Q703-240 720-240t28.5-11.5ZM680-440h170l-90-120h-80v120ZM360-540Z',
  order_approve: 'm691-150 139-138-42-42-97 95-39-39-42 43 81 81ZM240-600h480v-80H240v80ZM720-40q-83 0-141.5-58.5T520-240q0-83 58.5-141.5T720-440q83 0 141.5 58.5T920-240q0 83-58.5 141.5T720-40ZM120-80v-680q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v267q-19-9-39-15t-41-9v-243H200v562h243q5 31 15.5 59T486-86l-6 6-60-60-60 60-60-60-60 60-60-60-60 60Zm120-200h203q3-21 9-41t15-39H240v80Zm0-160h284q38-37 88.5-58.5T720-520H240v80Zm-40 242v-562 562Z',
}

/**
 * Placeholder art per record category, shown wherever a record has no logo or
 * photo — the round profile avatar and the table-row thumbnails alike. A given
 * category always uses the same icon, so a row and its detail page read as the
 * same thing.
 *
 * These are the SIDEBAR's icons for the same sections (see navigation.ts), so a
 * logo-less supplier row shows the very icon the user clicked to get there.
 * Competitors are the one category with no sidebar entry of its own, so they take
 * the runner from the design. Values use the same "ms:*" / PrimeIcons vocabulary
 * as the nav manifest; BasePlaceholderIcon.vue renders either.
 */
export type PlaceholderCategory =
  | 'item'
  | 'manufacturer'
  | 'supplier'
  | 'customer'
  | 'competitor'

export const PLACEHOLDER_ICONS: Record<PlaceholderCategory, string> = {
  item: 'ms:barcode_scanner',
  manufacturer: 'ms:precision_manufacturing',
  supplier: 'pi pi-box',
  customer: 'pi pi-building',
  competitor: 'ms:directions_run',
}
