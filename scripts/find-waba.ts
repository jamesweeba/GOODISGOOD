import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function findWabaId() {
  const token = process.env.WHATSAPP_TOKEN;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';

  if (!token) {
    console.error('Error: WHATSAPP_TOKEN is not set in .env');
    return;
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/${apiVersion}/me/whatsapp_business_accounts`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const accounts = response.data.data;
    if (accounts && accounts.length > 0) {
      console.log('\nFound WhatsApp Business Accounts:');
      accounts.forEach((acc: any) => {
        console.log(`- Name: ${acc.name}, ID: ${acc.id}`);
      });
      console.log('\nPlease add the ID to your .env as WHATSAPP_BUSINESS_ACCOUNT_ID');
    } else {
      console.log('No WhatsApp Business Accounts found for this token.');
    }
  } catch (error: any) {
    console.error('Error fetching WABA accounts:', error.response?.data || error.message);
  }
}

findWabaId();
