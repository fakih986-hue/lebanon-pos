import { create } from "zustand"
import type { Product } from "../types/product"

export type CartItem = Product & {
  quantity: number
}

type CartStore = {
  items: CartItem[]
  addItem: (item: Product) => void
  increaseQuantity: (id: number) => void
  decreaseQuantity: (id: number) => void
  removeItem: (id: number) => void
  clearCart: () => void
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],

  addItem: (item) =>
    set((state) => {
      if (item.stock <= 0) {
        return state
      }

      const existingItem = state.items.find((i) => i.id === item.id)

      if (existingItem) {
        if (existingItem.quantity >= item.stock) {
          return state
        }

        return {
          items: state.items.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  quantity: i.quantity + 1,
                }
              : i
          ),
        }
      }

      return {
        items: [
          ...state.items,
          {
            ...item,
            quantity: 1,
          },
        ],
      }
    }),

  increaseQuantity: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? item.quantity >= item.stock
            ? item
            : {
                ...item,
                quantity: item.quantity + 1,
              }
          : item
      ),
    })),

  decreaseQuantity: (id) =>
    set((state) => ({
      items: state.items
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0),
    })),

  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clearCart: () => set({ items: [] }),
}))
