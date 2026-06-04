import { memo } from "react"
import ProductCard from "./ProductCard"
import type { Product } from "../types/product"

type Props = {
  products: Product[]
  onAddProduct: (product: Product, source: string) => void
  onToggleFavorite: (product: Product) => void
  exchangeRate: number
}

const ProductGrid = memo(function ProductGrid({
  products,
  onAddProduct,
  onToggleFavorite,
  exchangeRate,
}: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-4 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(178px,1fr))]">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          exchangeRate={exchangeRate}
          onClick={() => onAddProduct(product, "tap")}
          onFavoriteToggle={() => onToggleFavorite(product)}
        />
      ))}
    </div>
  )
})

export default ProductGrid
