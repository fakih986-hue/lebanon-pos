import { prisma } from "../../packages/database/src/client"

async function main() {
  const drinks = await prisma.category.create({
    data: {
      name: "Drinks",
    },
  })

  const food = await prisma.category.create({
    data: {
      name: "Food",
    },
  })

  await prisma.product.createMany({
    data: [
      {
        name: "Coffee",
        price: 5,
        stock: 100,
        categoryId: drinks.id,
      },
      {
        name: "Pepsi",
        price: 2,
        stock: 200,
        categoryId: drinks.id,
      },
      {
        name: "Burger",
        price: 12,
        stock: 50,
        categoryId: food.id,
      },
      {
        name: "Pizza",
        price: 15,
        stock: 30,
        categoryId: food.id,
      },
    ],
  })

  console.log("Seed completed")
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
  })