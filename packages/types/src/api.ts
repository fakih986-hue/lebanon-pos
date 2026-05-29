export type ApiResponse<T = unknown> = {
  success: boolean
  data?: T
  error?: string
}

export type PaginatedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
