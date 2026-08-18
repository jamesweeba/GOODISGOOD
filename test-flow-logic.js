const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testFlowLogic() {
  console.log("Fetching top 3 longest named products from DB...");
  const products = await prisma.product.findMany({
    orderBy: { name: 'desc' }, // Just to get some products
    take: 3,
  });

  const screenData = {};
  for (let i = 0; i < 10; i++) {
    const p = products[i];
    if (p) {
      const suffix = ` - GHS ${Number(p.price).toFixed(2)}`;
      const maxNameLen = 30 - suffix.length;
      const shortName = p.name.length > maxNameLen 
        ? p.name.substring(0, maxNameLen - 3) + '...' 
        : p.name;
      screenData[`item_${i}_label`] = `${shortName}${suffix}`;
    } else {
      screenData[`item_${i}_label`] = ' ';
    }
    screenData[`item_${i}_id`] = p ? p.id : '';
    screenData[`show_${i}`] = p != null;
  }

  console.log("\n--- Generated screenData for QUANTITIES screen ---");
  for (let i = 0; i < 10; i++) {
    const label = screenData[`item_${i}_label`];
    console.log(`item_${i}_label: "${label}" (length: ${label.length})`);
    if (label.length > 30) {
      console.error(`❌ ERROR: Label length exceeds 30 chars!`);
    } else if (label.length === 0) {
      console.error(`❌ ERROR: Label is 0 chars!`);
    } else {
      console.log(`✅ OK`);
    }
  }
}

testFlowLogic()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
