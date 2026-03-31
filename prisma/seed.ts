import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = [
    {
      name: 'Classic Tee',
      price: 18.99,
      description: 'Soft cotton T-shirt available in black, white, and navy.',
    },
    {
      name: 'Premium Hoodie',
      price: 42.5,
      description: 'Heavyweight hoodie with brushed inner lining.',
    },
    {
      name: 'Canvas Tote',
      price: 14.0,
      description: 'Durable tote bag for everyday carry.',
    },
    {
      name: 'Sticker Pack',
      price: 6.5,
      description: 'Five weatherproof brand stickers in one pack.',
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { name: product.name },
      update: product,
      create: product,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

