/**
 * POS audio feedback (Midnight Gold design system).
 *
 * Tiny Web Audio blips — no assets, no latency. Ear-level feedback lets the
 * cashier keep their eyes on the customer/products instead of the screen:
 * scan-add confirms, error buzzes, sale-complete plays a two-note chime.
 *
 * Toggle persisted in localStorage (default ON). Volume kept low — this is
 * confirmation, not alarm.
 */

const SOUND_KEY = "lebanonpos.sound-enabled.v1"

let ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function isSoundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "false" } catch { return true }
}

export function setSoundEnabled(enabled: boolean) {
  try { localStorage.setItem(SOUND_KEY, String(enabled)) } catch { /* ignore */ }
}

function tone(freq: number, startAt: number, duration: number, volume: number, type: OscillatorType) {
  const ac = audioCtx()
  if (!ac) return
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = ac.currentTime + startAt
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

/** Short bright blip — product added to the sale. */
export function playScanBlip() {
  if (!isSoundEnabled()) return
  tone(1320, 0, 0.07, 0.12, "sine")
}

/** Low double-buzz — unknown barcode / blocked action. */
export function playErrorBuzz() {
  if (!isSoundEnabled()) return
  tone(220, 0, 0.09, 0.1, "square")
  tone(196, 0.11, 0.12, 0.1, "square")
}

/** Two-note ascending chime — sale completed. */
export function playSaleChime() {
  if (!isSoundEnabled()) return
  tone(880, 0, 0.12, 0.12, "sine")
  tone(1318.5, 0.12, 0.22, 0.12, "sine")
}
