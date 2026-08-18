import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.product.count();
  console.log(`PRODUCT_COUNT:${count}`);
  const products = await prisma.product.findMany({ take: 5 });
  console.log('SAMPLES:', JSON.stringify(products));
}
main().catch(console.error).finally(() => prisma.$disconnect());
