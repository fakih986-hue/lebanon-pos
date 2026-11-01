import { memo } from "react"
import ProductCard from "./ProductCard"
import type { Product } from "../types/product"

type Props = {
  products: Product[]
  onAddProduct: (product: Product, source: string) => void
  onToggleFavorite: (product: Product) => void
  exchangeRate: number
  wholesale?: boolean
  cartQuantities?: Record<number, number>
  searchQuery?: string
  /** Café batch: servings a recipe drink's ingredients in stock can still make (by product id) */
  servings?: Map<number, number | null>
}

const ProductGrid = memo(function ProductGrid({
  products,
  onAddProduct,
  onToggleFavorite,
  exchangeRate,
  wholesale,
  cartQuantities,
  searchQuery,
  servings,
}: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 pb-4 sm:grid-cols-[repeat(auto-fill,minmax(155px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(165px,1fr))]">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          exchangeRate={exchangeRate}
          onClick={() => onAddProduct(product, "tap")}
          onFavoriteToggle={() => onToggleFavorite(product)}
          wholesale={wholesale}
          cartQuantity={cartQuantities?.[product.id] ?? 0}
          searchQuery={searchQuery}
          servings={servings?.get(product.id) ?? null}
        />
      ))}
    </div>
  )
})

export default ProductGrid
