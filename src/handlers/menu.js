const { all } = require('../database/db');

const menuText = `👋 Bem-vindo à DigiStore

1️⃣ Número WhatsApp BR — R$7
2️⃣ Número Telegram — R$7
3️⃣ Gmail — R$7
4️⃣ Instagram — R$7
5️⃣ Facebook — R$7
6️⃣ USA / Europa — R$10

💳 MINHA CONTA

7️⃣ Ver saldo
8️⃣ Recarregar saldo
9️⃣ Histórico`;

function isMenuTrigger(text) {
  const clean = (text || '').trim().toLowerCase();
  return ['oi', 'menu', '0'].includes(clean);
}

function rechargeMenu() {
  return 'Escolha o valor da recarga PIX:\n\n• 10\n• 20\n• 50\n• 100';
}

async function formatHistory(userId) {
  const orders = await all(
    `SELECT service_key, phone_number, sms_code, status, amount, created_at
     FROM pedidos WHERE user_id = ? ORDER BY id DESC LIMIT 10`,
    [userId]
  );

  if (!orders.length) return 'Você ainda não possui pedidos.';

  const lines = orders.map(
    (o, i) => `${i + 1}. Serviço ${o.service_key} | ${o.phone_number || '-'} | ${o.status} | R$${o.amount}`
  );

  return `📜 Últimos pedidos:\n\n${lines.join('\n')}`;
}

module.exports = {
  menuText,
  isMenuTrigger,
  rechargeMenu,
  formatHistory,
};
