import { ShiftScopeError } from "../services/security.service"

type T = (key: string, vars?: Record<string, string | number>) => string
/** Batch 83: the reason a shift could not be opened, in the register's language (another register's drawer is open). */
export function shiftOpenRefusal(err: unknown, t: T): string {
  if (err instanceof ShiftScopeError) return t("pos.drawer.other_register_text", { shift: err.shift.shiftNumber, register: err.shift.deviceName || t("pos.drawer.another_register"), name: err.shift.openedByName })
  return err instanceof Error ? err.message : String(err)
}
