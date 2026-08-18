import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function generateCsv() {
  console.log('🚀 Generating Facebook Catalog Feed...');
  
  const products = await prisma.product.findMany({
    where: { active: true }
  });

  if (products.length === 0) {
    console.error('❌ No products found in database!');
    return;
  }

  // Header for Facebook Catalog CSV
  const header = 'id,title,description,availability,condition,price,link,image_link,brand\n';
  
  const rows = products.map(p => {
    // Basic mapping
    const id = p.id;
    const title = p.name.replace(/,/g, ''); // Remove commas to avoid CSV break
    const description = (p.description || p.name).replace(/,/g, '');
    const availability = 'in stock';
    const condition = 'new';
    const price = `${Number(p.price).toFixed(2)} GHS`;
    const link = `https://wa.me/your_number?text=Check out ${title}`; // Fallback link
    const image_link = p.imageUrl || 'https://via.placeholder.com/500';
    const brand = 'GODISGOOD';

    return `${id},${title},${description},${availability},${condition},${price},${link},${image_link},${brand}`;
  });

  const csvContent = header + rows.join('\n');
  const filePath = path.join(process.cwd(), 'facebook_catalog.csv');
  
  fs.writeFileSync(filePath, csvContent);
  
  console.log(`✅ Success! Catalog exported to: ${filePath}`);
  console.log(`💡 Next Step: Upload this file to Meta Commerce Manager (https://business.facebook.com/commerce)`);
}

generateCsv()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
