const axios = require('axios');
require('dotenv').config();

async function findWabaViaPhone() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';

  if (!token || !phoneId) {
    console.error('Error: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID is not set in .env');
    return;
  }

  try {
    const response = await axios.get(`https://graph.facebook.com/${apiVersion}/${phoneId}`, {
      params: { fields: 'whatsapp_business_account' },
      headers: { Authorization: `Bearer ${token}` }
    });

    const waba = response.data.whatsapp_business_account;
    if (waba && waba.id) {
      console.log(`\nSuccess! Your WhatsApp Business Account ID is: ${waba.id}`);
      console.log('Please add this to your .env as WHATSAPP_BUSINESS_ACCOUNT_ID');
    } else {
      console.log('Could not find WABA ID associated with this Phone ID.');
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.error('Error fetching WABA from phone:', error.response ? error.response.data : error.message);
  }
}

findWabaViaPhone();
