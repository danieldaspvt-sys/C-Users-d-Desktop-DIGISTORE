const { get, run, updateBalance } = require('../database/db');
const { getServiceByKey, requestNumber, checkSmsCode, cancelOrder } = require('../services/herosms');

const activeMonitors = new Map();
const ORDER_TIMEOUT_MS = 20 * 60 * 1000;

async function hasActiveOrder(userId) {
  const row = await get(
    `SELECT id FROM pedidos
     WHERE user_id = ? AND status IN ('pending', 'number_sent', 'waiting_sms')
     ORDER BY id DESC LIMIT 1`,
    [userId]
  );

  return !!row;
}

async function createOrder(user, serviceKey, sock, remoteJid, quotedMsg) {
  const service = getServiceByKey(serviceKey);
  if (!service) {
    return 'Serviço inválido. Envie *menu* para ver opções.';
  }

  if (await hasActiveOrder(user.id)) {
    return 'Você já possui um pedido ativo. Aguarde SMS ou cancelamento automático.';
  }

  if (Number(user.balance) < service.price) {
    return `Saldo insuficiente. Seu saldo: R$${Number(user.balance).toFixed(2)} | Valor: R$${service.price}`;
  }

  let orderId;
  try {
    await updateBalance(user.id, -service.price);
    const purchase = await requestNumber(serviceKey);

    const order = await run(
      `INSERT INTO pedidos(user_id, hero_order_id, service_key, phone_number, status, amount)
       VALUES(?, ?, ?, ?, 'waiting_sms', ?)`,
      [user.id, purchase.heroOrderId, serviceKey, purchase.phoneNumber, service.price]
    );

    orderId = order.id;

    await sock.sendMessage(remoteJid, {
      text: `📱 Número gerado\n\n+${purchase.phoneNumber}\n\nAguardando SMS...`,
    }, { quoted: quotedMsg });

    await monitorSms(orderId, purchase.heroOrderId, user.id, service.price, sock, remoteJid, quotedMsg);
    return null;
  } catch (error) {
    if (orderId) {
      await run('UPDATE pedidos SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['failed', orderId]);
    }

    await updateBalance(user.id, service.price).catch(() => null);
    return `Falha ao criar pedido: ${error.message}`;
  }
}

async function monitorSms(orderId, heroOrderId, userId, amount, sock, remoteJid, quotedMsg) {
  const start = Date.now();

  const timer = setInterval(async () => {
    try {
      const status = await checkSmsCode(heroOrderId);
      const code = status?.sms?.[0]?.code || status?.code || null;

      if (code) {
        clearInterval(timer);
        activeMonitors.delete(orderId);
        await run(
          `UPDATE pedidos
           SET status = 'completed', sms_code = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [String(code), orderId]
        );

        await sock.sendMessage(remoteJid, { text: `✅ SMS recebido: *${code}*` }, { quoted: quotedMsg });
        return;
      }

      if (Date.now() - start > ORDER_TIMEOUT_MS) {
        clearInterval(timer);
        activeMonitors.delete(orderId);

        await cancelOrder(heroOrderId).catch(() => null);
        await updateBalance(userId, amount);

        await run(
          `UPDATE pedidos
           SET status = 'timeout_refunded', refund_applied = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [orderId]
        );

        await sock.sendMessage(
          remoteJid,
          { text: '⏰ SMS não recebido em 20 minutos. Valor estornado para seu saldo.' },
          { quoted: quotedMsg }
        );
      }
    } catch (error) {
      // Mantém monitoramento em caso de falhas transitórias
      await run('UPDATE pedidos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [orderId]);
    }
  }, 15000);

  activeMonitors.set(orderId, timer);
}

module.exports = {
  createOrder,
};
