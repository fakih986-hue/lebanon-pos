import { Delete } from "lucide-react"

interface NumpadProps {
  onDigit: (digit: string) => void
  onBackspace: () => void
  onSubmit?: () => void
  /** Label for the bottom-left key; omit to leave it blank. */
  submitLabel?: string
  disabled?: boolean
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]

/**
 * Shared numeric keypad (Midnight Gold): PIN lock, tender entry, quantity.
 * Big 56px touch targets, tabular digits, press-scale feedback.
 */
export default function Numpad({ onDigit, onBackspace, onSubmit, submitLabel, disabled }: NumpadProps) {
  const keyStyle: React.CSSProperties = {
    height: 56,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--surface-2)",
    color: "var(--text)",
    fontSize: 20,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    transition: "background-color var(--dur-btn) ease, transform var(--dur-fast) ease",
  }

  const Key = ({ children, onClick, aria }: { children: React.ReactNode; onClick: () => void; aria: string }) => (
    <button
      type="button"
      aria-label={aria}
      disabled={disabled}
      onClick={onClick}
      style={keyStyle}
      className="numpad-key flex items-center justify-center select-none"
    >
      {children}
    </button>
  )

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Numeric keypad">
      {DIGITS.map((d) => (
        <Key key={d} aria={d} onClick={() => onDigit(d)}>{d}</Key>
      ))}
      {onSubmit && submitLabel ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onSubmit}
          className="numpad-key flex items-center justify-center select-none"
          style={{ ...keyStyle, background: "var(--brand)", borderColor: "var(--brand)", color: "var(--brand-contrast)", fontSize: 14 }}
        >
          {submitLabel}
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <Key aria="0" onClick={() => onDigit("0")}>0</Key>
      <Key aria="Backspace" onClick={onBackspace}><Delete size={20} /></Key>
    </div>
  )
}
