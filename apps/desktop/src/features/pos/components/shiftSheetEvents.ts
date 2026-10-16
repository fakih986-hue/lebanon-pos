/** Fired by anything that wants the shift sheet open (topbar chip, register banner). */
export const OPEN_SHIFT_SHEET_EVENT = "lebanonpos-open-shift-sheet"
export function openShiftSheet() {
  window.dispatchEvent(new Event(OPEN_SHIFT_SHEET_EVENT))
}
