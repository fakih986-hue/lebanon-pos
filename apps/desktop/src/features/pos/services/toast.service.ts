import { create } from "zustand"
import type { ToastMessage, ToastType } from "../../components/ui/Toast"

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
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }))
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
  success: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "success", message }] }))
  },
  error: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "error", message }] }))
  },
  info: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "info", message }] }))
  },
  warning: (message) => {
    const id = `toast-${++counter}`
    set((state) => ({ toasts: [...state.toasts, { id, type: "warning", message }] }))
  },
}))

export function showToast(message: string, type?: ToastType) {
  useToastStore.getState().toast(message, type)
}
