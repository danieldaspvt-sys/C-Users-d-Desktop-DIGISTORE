const axios = require('axios');

const PUSHINPAY_BASE_URL = 'https://api.pushinpay.com.br/api';
const token = process.env.PUSHINPAY_TOKEN;

function client() {
  return axios.create({
    baseURL: PUSHINPAY_BASE_URL,
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

async function createPixCharge(amount, customerName, externalId) {
  const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/pix`;
  const payload = {
    value: Math.round(amount * 100),
    webhook_url: webhookUrl,
    external_reference: externalId,
    payer_name: customerName || 'Cliente DigiStore',
  };

  const { data } = await client().post('/pix/cashIn', payload);

  return {
    txid: data.id || data.txid || data.external_reference,
    pixCode: data.qr_code || data.copy_and_paste || data.pix_code,
    raw: data,
  };
}

module.exports = {
  createPixCharge,
};
