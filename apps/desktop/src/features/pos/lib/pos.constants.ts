import type { LucideIcon } from "lucide-react"
import {
  Candy,
  Croissant,
  CupSoda,
  LayoutGrid,
  ShoppingBasket,
  Star,
  Utensils,
} from "lucide-react"

export const departmentIcons: Record<string, LucideIcon> = {
  All: LayoutGrid,
  Favorites: Star,
  Drinks: CupSoda,
  Bakery: Croissant,
  Food: Utensils,
  Snacks: Candy,
  Pantry: ShoppingBasket,
}

export function normalizeBarcode(value: string) {
  return value.trim().replace(/\s+/g, "")
}
