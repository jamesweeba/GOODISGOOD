const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function deployFlow() {
  const token = process.env.WHATSAPP_TOKEN;
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const flowName = 'QuickPurchaseFlow';

  if (!token || !wabaId) {
    console.error('Error: WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID must be set in .env');
    return;
  }

  try {
    // 1. Create or Find the Flow
    console.log(`Checking for existing flow named "${flowName}"...`);
    const listResponse = await axios.get(`https://graph.facebook.com/${apiVersion}/${wabaId}/flows`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    let flowId = listResponse.data.data ? listResponse.data.data.find((f) => f.name === flowName) : null;
    if (flowId) flowId = flowId.id;

    if (!flowId) {
      console.log('Flow not found. Creating new flow...');
      const createResponse = await axios.post(
        `https://graph.facebook.com/${apiVersion}/${wabaId}/flows`,
        {
          name: flowName,
          categories: ['OTHER']
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      flowId = createResponse.data.id;
      console.log(`Created Flow ID: ${flowId}`);
    } else {
      console.log(`Found existing Flow ID: ${flowId}`);
    }

    // 2. Upload the JSON Asset
    console.log('Uploading flow.json asset...');
    const jsonPath = path.join(process.cwd(), 'flow.json');
    const jsonContent = fs.readFileSync(jsonPath);
    
    // Using form-data compatible approach for older Node
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', jsonContent, { filename: 'flow.json', contentType: 'application/json' });
    formData.append('name', 'flow.json');
    formData.append('asset_type', 'FLOW_JSON');

    await axios.post(
      `https://graph.facebook.com/${apiVersion}/${flowId}/assets`,
      formData,
      {
        headers: Object.assign({
          'Authorization': `Bearer ${token}`
        }, formData.getHeaders())
      }
    );

    console.log('✅ Flow asset uploaded successfully!');

    // 3. Set the Data Exchange Endpoint URI
    const baseUrl = process.env.APP_BASE_URL;
    if (baseUrl) {
      const endpointUri = `${baseUrl}/webhook/flow`;
      console.log(`Setting endpoint_uri to: ${endpointUri}`);
      await axios.post(
        `https://graph.facebook.com/${apiVersion}/${flowId}`,
        { endpoint_uri: endpointUri },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log('✅ Endpoint URI configured successfully!');
    } else {
      console.warn('⚠️  APP_BASE_URL not set in .env — skipping endpoint_uri configuration.');
      console.warn('   Set APP_BASE_URL to your ngrok URL and re-run to enable data exchange.');
    }

    console.log(`\nYour Flow ID is: ${flowId}`);
    console.log('Please update your .env with WHATSAPP_FLOW_ID=' + flowId);

  } catch (error) {
    console.error('Error deploying flow:', error.response ? error.response.data : error.message);
  }
}

deployFlow();
