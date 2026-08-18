import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

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

    let flowId = listResponse.data.data?.find((f: any) => f.name === flowName)?.id;

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
    
    const formData = new FormData();
    const blob = new Blob([jsonContent], { type: 'application/json' });
    formData.append('file', blob, 'flow.json');
    formData.append('name', 'flow.json');
    formData.append('asset_type', 'FLOW_JSON');

    await axios.post(
      `https://graph.facebook.com/${apiVersion}/${flowId}/assets`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          // Axios handles Content-Type for FormData automatically
        }
      }
    );

    console.log('✅ Flow asset uploaded successfully!');
    console.log(`\nYour Flow ID is: ${flowId}`);
    console.log('Please update your .env with WHATSAPP_FLOW_ID=' + flowId);
    
    // 3. Publish (Optional - Flows must be published to be used in production)
    // console.log('Publishing flow...');
    // await axios.post(`https://graph.facebook.com/${apiVersion}/${flowId}/publish`, {}, {
    //   headers: { Authorization: `Bearer ${token}` }
    // });
    // console.log('Flow published!');

  } catch (error: any) {
    console.error('Error deploying flow:', error.response?.data || error.message);
  }
}

deployFlow();
