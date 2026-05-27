import { Request, Router } from "express"
const r = {} as Request
console.log(r.body)
const router = Router()
router.post("/test", async (req: Request) => {
  console.log(req.body)
})
