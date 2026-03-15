const axios = require('axios');

const HERO_BASE_URL = 'https://2sim.cloud/api/v1';
const HERO_API_KEY = process.env.HEROSMS_API_KEY;

const serviceCatalog = {
  '1': { label: 'Número WhatsApp BR', price: 7, service: 'wa', country: 'br' },
  '2': { label: 'Número Telegram', price: 7, service: 'tg', country: 'br' },
  '3': { label: 'Gmail', price: 7, service: 'go', country: 'br' },
  '4': { label: 'Instagram', price: 7, service: 'ig', country: 'br' },
  '5': { label: 'Facebook', price: 7, service: 'fb', country: 'br' },
  '6': { label: 'USA / Europa', price: 10, service: 'wa', country: 'us' },
};

function getServiceByKey(key) {
  return serviceCatalog[key];
}

async function requestNumber(serviceKey) {
  const svc = getServiceByKey(serviceKey);
  if (!svc) {
    throw new Error('Serviço inválido.');
  }

  const { data } = await axios.get(`${HERO_BASE_URL}/user/buy/activation/${svc.country}/${svc.service}`, {
    params: { apikey: HERO_API_KEY },
    timeout: 20000,
  });

  if (!data || !data.id || !data.phone) {
    throw new Error(`HeroSMS sem número disponível: ${JSON.stringify(data)}`);
  }

  return {
    heroOrderId: String(data.id),
    phoneNumber: String(data.phone),
    service: svc,
  };
}

async function checkSmsCode(heroOrderId) {
  const { data } = await axios.get(`${HERO_BASE_URL}/user/check/${heroOrderId}`, {
    params: { apikey: HERO_API_KEY },
    timeout: 20000,
  });

  return data;
}

async function cancelOrder(heroOrderId) {
  const { data } = await axios.get(`${HERO_BASE_URL}/user/cancel/${heroOrderId}`, {
    params: { apikey: HERO_API_KEY },
    timeout: 20000,
  });

  return data;
}

module.exports = {
  serviceCatalog,
  getServiceByKey,
  requestNumber,
  checkSmsCode,
  cancelOrder,
};
