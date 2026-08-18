import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = [
    // --- VEGETABLES ---
    { name: 'Fresh Tomatoes (Big Paint Bucket)', price: 45.00, description: 'Fresh, firm tomatoes from Kaneshie market.' },
    { name: 'Red Onions (Medium Bag)', price: 35.00, description: 'Sharp and flavorful red onions.' },
    { name: 'Kpakposhito (Green Pepper)', price: 12.00, description: 'Highly aromatic local green petite pepper.' },
    { name: 'Scotch Bonnet Pepper (Red)', price: 10.00, description: 'Hot and spicy red pepper.' },
    { name: 'Garden Eggs (Large Basket)', price: 25.00, description: 'Fresh local garden eggs for stews and soups.' },
    { name: 'Okra (Medium Bowl)', price: 15.00, description: 'Freshly harvested green okra.' },
    { name: 'Cabbage (Large Head)', price: 8.00, description: 'Crisp green cabbage.' },
    { name: 'Carrots (Bunch)', price: 10.00, description: 'Sweet and crunchy local carrots.' },
    { name: 'Green Bell Pepper (Per Piece)', price: 3.50, description: 'Fresh green bell peppers.' },
    { name: 'Ginger (Medium Bowl)', price: 15.00, description: 'Strong, spicy local ginger roots.' },
    { name: 'Garlic (Per Pack)', price: 12.00, description: 'Flavorful local garlic bulbs.' },
    { name: 'Spring Onions (Bunch)', price: 5.00, description: 'Freshly harvested spring onions.' },
    { name: 'Local Spinach (Kontomire - Bunch)', price: 5.00, description: 'Fresh cocoyam leaves for palava sauce.' },
    { name: 'Lettuce (Head)', price: 6.00, description: 'Fresh green leaf lettuce.' },
    { name: 'Cucumber (Per Piece)', price: 4.00, description: 'Cool and crisp cucumbers.' },

    // --- TUBERS & ROOTS ---
    { name: 'Pona Yam (Large Tuber)', price: 25.00, description: 'High quality Pona yam, sweet and mealy.' },
    { name: 'Labirako Yam (Tuber)', price: 20.00, description: 'Soft and tasty Labirako yam.' },
    { name: 'Cassava (Per Bunch)', price: 15.00, description: 'Fresh cassava roots for fufu or ampesi.' },
    { name: 'Cocoyam (Per Bunch)', price: 30.00, description: 'Fresh white cocoyam.' },
    { name: 'Sweet Potato (Medium Bowl)', price: 15.00, description: 'Orange-fleshed local sweet potatoes.' },
    { name: 'Unripe Plantain (Bunch)', price: 40.00, description: 'Green plantain for boiling or roasting.' },
    { name: 'Ripe Plantain (Bunch)', price: 45.00, description: 'Yellow ripe plantain for kelewele or tatale.' },

    // --- GRAINS & CEREALS ---
    { name: 'Local Rice (5kg Bag)', price: 85.00, description: 'Nutritious unpolished local Ghanaian rice.' },
    { name: 'Perfume Rice (5kg Bag)', price: 120.00, description: 'High quality aromatic long grain rice.' },
    { name: 'White Maize (Olonka)', price: 18.00, description: 'Dry white maize for banku or kenkey.' },
    { name: 'Yellow Maize (Olonka)', price: 20.00, description: 'Dry yellow maize for poultry or porridge.' },
    { name: 'Millet (Olonka)', price: 25.00, description: 'Local millet for hausa koko.' },
    { name: 'Sorghum (Olonka)', price: 22.00, description: 'Rich local sorghum grains.' },

    // --- LEGUMES & NUTS ---
    { name: 'White Beans (Olonka)', price: 35.00, description: 'Dry white cowpea beans.' },
    { name: 'Red Beans (Olonka)', price: 38.00, description: 'Nutritious red beans.' },
    { name: 'Soya Beans (Olonka)', price: 30.00, description: 'High protein soya beans.' },
    { name: 'Raw Groundnuts (Olonka)', price: 45.00, description: 'Fresh raw groundnuts for soup or roasting.' },
    { name: 'Roasted Groundnuts (Bottle)', price: 15.00, description: 'Crunchy roasted groundnuts.' },
    { name: 'Agushie (Small Bowl)', price: 25.00, description: 'Dried melon seeds for agushie stew.' },

    // --- OILS & FATS ---
    { name: 'Palm Oil (1 Liter)', price: 22.00, description: 'Rich, red unrefined palm oil (Zomi).' },
    { name: 'Vegetable Oil (1 Liter)', price: 28.00, description: 'Refined cooking oil.' },
    { name: 'Coconut Oil (Bottle)', price: 30.00, description: 'Pure local coconut oil.' },
    { name: 'Shea Butter (Per Pack)', price: 10.00, description: 'Pure unrefined local shea butter.' },

    // --- FISH & MEAT (PROCESSED) ---
    { name: 'Smoked Herrings (10 Pieces)', price: 25.00, description: 'Tasty smoked herrings (Maniwa).' },
    { name: 'Salted Fish (Koobi - Per Piece)', price: 15.00, description: 'Traditional salted dried tilapia.' },
    { name: 'Momoni (Small Piece)', price: 5.00, description: 'Fermented salted fish for seasoning stews.' },
    { name: 'Dried Anchovies (Keta School Boys - Olonka)', price: 40.00, description: 'Small dried fish for sauces.' },
    { name: 'Smoked Tuna (Medium Piece)', price: 35.00, description: 'Flaky smoked tuna fish.' },
    { name: 'Dried Shrimp (Small Bowl)', price: 20.00, description: 'Flavorful dried shrimp for seasoning.' },

    // --- FRUITS ---
    { name: 'Large Mango (Per Piece)', price: 5.00, description: 'Sweet and juicy local mango.' },
    { name: 'Pineapple (Large)', price: 10.00, description: 'Sweet sugar loaf pineapple.' },
    { name: 'Watermelon (Large)', price: 25.00, description: 'Large, refreshing watermelon.' },
    { name: 'Banana (Bunch)', price: 15.00, description: 'Sweet yellow bananas.' },
    { name: 'Pawpaw (Large)', price: 12.00, description: 'Ripe and sweet local papaya.' },
    { name: 'Oranges (10 Pieces)', price: 10.00, description: 'Juicy local oranges.' },
    { name: 'Avocado Pear (Per Piece)', price: 6.00, description: 'Creamy local avocado pear.' },
    { name: 'Coconut (Per Piece)', price: 4.00, description: 'Fresh coconut with water and meat.' },

    // --- PROCESSED FOODS ---
    { name: 'Gari (Olonka)', price: 25.00, description: 'Fine, dry fermented cassava grits.' },
    { name: 'Banku Mix (Per KG)', price: 12.00, description: 'Pre-mixed fermented corn and cassava dough.' },
    { name: 'Hausa Koko Flour (Large Pack)', price: 25.00, description: 'Spiced millet flour for porridge.' },
    { name: 'Tom Brown (Large Pack)', price: 30.00, description: 'Roasted multi-grain cereal for porridge.' },
    { name: 'Fufu Flour (Plantain)', price: 45.00, description: 'Instant plantain fufu flour.' },

    // --- SPICES & MISC ---
    { name: 'Local Salt (Large Pack)', price: 5.00, description: 'Fine white cooking salt.' },
    { name: 'Cloves (Pebre - Small Pack)', price: 5.00, description: 'Aromatic whole cloves.' },
    { name: 'Aniseed (Nketekete - Small Pack)', price: 5.00, description: 'Sweet local aniseed.' },
    { name: 'Black Pepper (Whole)', price: 8.00, description: 'Whole black peppercorns.' },
    { name: 'Nutmeg (3 Pieces)', price: 5.00, description: 'Whole local nutmeg.' },
    { name: 'Dawadawa (Per Ball)', price: 3.00, description: 'Traditional fermented locust bean seasoning.' },
    { name: 'Dried Hibiscus (Sobolo Leaves)', price: 15.00, description: 'Dried leaves for making Sobolo drink.' },

    // ... Adding more to reach near 100
    { name: 'Yellow Garri (Olonka)', price: 28.00, description: 'Gari processed with palm oil.' },
    { name: 'Akyeke (Per Pack)', price: 10.00, description: 'Steamed cassava couscous.' },
    { name: 'Fried Fish (Snapper)', price: 30.00, description: 'Large fried snapper fish.' },
    { name: 'Cow Skin (Wele - Piece)', price: 5.00, description: 'Boiled and softened cow skin.' },
    { name: 'Local Eggs (Crate)', price: 65.00, description: 'Fresh local poultry eggs.' },
    { name: 'Mushrooms (Pack)', price: 20.00, description: 'Fresh oyster mushrooms.' },
    { name: 'Lemon (5 Pieces)', price: 5.00, description: 'Fresh yellow lemons.' },
    { name: 'Lime (5 Pieces)', price: 5.00, description: 'Tart green limes.' },
    { name: 'Honey (Bottle)', price: 45.00, description: 'Pure unrefined local honey.' },
    { name: 'Bambara Beans (Olonka)', price: 40.00, description: 'Nutritious local bambara beans.' },
    { name: 'Egusi (Olonka)', price: 55.00, description: 'Ground melon seeds.' },
    { name: 'Yam Flour (Lafun)', price: 30.00, description: 'Processed yam flour for amala.' },
    { name: 'Kokonte Flour (Olonka)', price: 20.00, description: 'Dried cassava flour for kokonte.' },
    { name: 'Corn Dough (Olonka)', price: 15.00, description: 'Fresh fermented corn dough.' },
    { name: 'Cassava Dough (Olonka)', price: 15.00, description: 'Fresh fermented cassava dough.' },
    { name: 'Turkey Berries (Small Bowl)', price: 10.00, description: 'Nutritious local turkey berries (Abadua).' },
    { name: 'Garden Egg Powder', price: 15.00, description: 'Dried and powdered garden eggs.' },
    { name: 'Shito (Large Jar)', price: 55.00, description: 'Homemade spicy black pepper sauce.' },
    { name: 'Dry Okra Powder', price: 10.00, description: 'Dried and ground okra.' },
    { name: 'Peanut Butter (Local - Jar)', price: 25.00, description: 'Smooth local peanut paste.' },
    { name: 'Hibiscus Petals (Large Bag)', price: 35.00, description: 'Dried petals for large batch Sobolo.' },
    { name: 'Local Brown Sugar (KG)', price: 15.00, description: 'Unrefined local sugar.' },
    { name: 'Breadfruit (Large)', price: 20.00, description: 'Fresh local breadfruit.' },
    { name: 'African Star Apple (Alasa - 5 Pieces)', price: 10.00, description: 'Sweet and tart seasonal fruit.' },
    { name: 'Tamarind (Pack)', price: 12.00, description: 'Local tamarind pods.' },
    { name: 'Baobab Powder', price: 30.00, description: 'Nutritious baobab fruit powder.' },
    { name: 'Tiger Nuts (Olonka)', price: 50.00, description: 'Fresh crunchy tiger nuts (Atadwe).' },
    { name: 'Date Fruit (Pack)', price: 20.00, description: 'Sweet dried dates.' },
    { name: 'Moringa Powder', price: 25.00, description: 'Organic moringa leaf powder.' },
    { name: 'Prekese (4 Pieces)', price: 10.00, description: 'Aromatic fruit for soup and medicinal use.' },
    { name: 'Ginger Powder', price: 15.00, description: 'Fine ground local ginger.' },
    { name: 'Garlic Powder', price: 15.00, description: 'Fine ground local garlic.' },
    { name: 'Soya Chunks', price: 20.00, description: 'Textured vegetable protein from soya.' },
    { name: 'Local Coffee Beans', price: 45.00, description: 'Roasted Ghanaian coffee beans.' },
    { name: 'Cocoa Powder (Pure)', price: 35.00, description: '100% Ghanaian cocoa powder.' },
    { name: 'Bitter Kola (5 Pieces)', price: 10.00, description: 'Traditional bitter kola nuts.' },
    { name: 'Kola Nuts (5 Pieces)', price: 10.00, description: 'Traditional kola nuts.' }
  ];

  console.log('Seeding products...');

  for (const product of products) {
    await prisma.product.upsert({
      where: { name: product.name },
      update: product,
      create: product,
    });
  }

  console.log(`Successfully seeded ${products.length} products.`);
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
