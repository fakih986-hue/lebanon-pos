import { create } from "zustand"
import type { ToastMessage, ToastType } from "../../../components/ui/Toast"

interface ToastStore {
  toasts: ToastMessage[]
  toast: (message: string, type?: ToastType) => void
  dismiss: (id: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

let counter = 0

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  toast: (message, type = "info") => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type, message }].slice(-2) }))
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
  success: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "success" as const, message }].slice(-2) }))
  },
  error: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "error" as const, message }].slice(-2) }))
  },
  info: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "info" as const, message }].slice(-2) }))
  },
  warning: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "warning" as const, message }].slice(-2) }))
  },
}))

export function showToast(message: string, type?: ToastType) {
  useToastStore.getState().toast(message, type)
}
