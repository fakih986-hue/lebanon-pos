import "express"

declare module "express" {
  interface Request {
    auth?: {
      userId: string
      tenantId: string
      role: string
    }
  }

  interface Response {
    status(code: number): this
    json(body?: unknown): this
  }
}
