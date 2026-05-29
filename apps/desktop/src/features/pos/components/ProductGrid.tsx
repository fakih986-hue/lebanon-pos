import { memo } from "react"
import ProductCard from "./ProductCard"
import type { Product } from "../types/product"

type Props = {
  products: Product[]
  onAddProduct: (product: Product, source: string) => void
  onToggleFavorite: (product: Product) => void
}

const ProductGrid = memo(function ProductGrid({
  products,
  onAddProduct,
  onToggleFavorite,
}: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-4 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] xl:gap-4">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onClick={() => onAddProduct(product, "tap")}
          onFavoriteToggle={() => onToggleFavorite(product)}
        />
      ))}
    </div>
  )
})

export default ProductGrid
