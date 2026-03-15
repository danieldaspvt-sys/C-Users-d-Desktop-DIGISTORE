const { all, get, run, updateBalance } = require('../database/db');

function isAdmin(senderNumber) {
  return senderNumber === process.env.ADMIN_NUMBER;
}

async function handleAdminCommand(text, sock) {
  const [command, ...args] = text.trim().split(' ');

  if (command === '!users') {
    const row = await get('SELECT COUNT(*) as total FROM users');
    return `Total de usuários: ${row.total}`;
  }

  if (command === '!pedidos') {
    const row = await get('SELECT COUNT(*) as total FROM pedidos');
    return `Total de pedidos: ${row.total}`;
  }

  if (command === '!saldo') {
    const number = args[0];
    const amount = Number(args[1]);
    if (!number || Number.isNaN(amount)) {
      return 'Uso: !saldo 5591999999999 10';
    }

    const user = await get('SELECT * FROM users WHERE number = ?', [number]);
    if (!user) return 'Usuário não encontrado.';

    const balance = await updateBalance(user.id, amount);
    await run(
      'INSERT INTO mensagens(user_id, direction, message_text) VALUES(?, ?, ?)',
      [user.id, 'system', `Admin alterou saldo em R$${amount}`]
    );

    return `Saldo atualizado para ${number}: R$${balance.toFixed(2)}`;
  }

  if (command === '!broadcast') {
    const message = args.join(' ').trim();
    if (!message) return 'Uso: !broadcast mensagem';

    const users = await all('SELECT number FROM users');
    for (const u of users) {
      const jid = `${u.number}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text: `📢 ${message}` });
    }
    return `Broadcast enviado para ${users.length} usuários.`;
  }

  return null;
}

module.exports = {
  isAdmin,
  handleAdminCommand,
};
