require('dotenv').config();
const path = require('path');
const express = require('express');
const pino = require('pino');

const { initDatabase, get, all, run, updateBalance } = require('./database/db');
const { startBot } = require('./bot');

const app = express();
app.use(express.json());
const logger = pino({ level: 'info' });

let sock;

app.get('/', (req, res) => {
  res.send('DigiStore bot running');
});

app.use('/painel', express.static(path.join(__dirname, '../painel')));

app.get('/api/stats', async (req, res) => {
  const [users, pedidos, faturamento, mensagens, saldos] = await Promise.all([
    get('SELECT COUNT(*) as total FROM users'),
    get('SELECT COUNT(*) as total FROM pedidos'),
    get("SELECT COALESCE(SUM(amount), 0) as total FROM recargas WHERE status = 'paid'"),
    get('SELECT COUNT(*) as total FROM mensagens'),
    all(
      `SELECT u.number, u.name, COALESCE(s.balance, 0) as balance
       FROM users u LEFT JOIN saldo s ON s.user_id = u.id
       ORDER BY balance DESC LIMIT 50`
    ),
  ]);

  res.json({
    users: users.total,
    pedidos: pedidos.total,
    faturamento: Number(faturamento.total || 0),
    mensagens: mensagens.total,
    saldos,
  });
});

app.post('/webhook/pix', async (req, res) => {
  try {
    const payload = req.body || {};
    const txid = payload.id || payload.txid || payload.external_reference;
    const status = String(payload.status || '').toLowerCase();

    if (!txid) {
      return res.status(400).json({ error: 'txid ausente' });
    }

    const recarga = await get('SELECT * FROM recargas WHERE txid = ?', [txid]);
    if (!recarga) {
      return res.status(404).json({ error: 'recarga não encontrada' });
    }

    if (recarga.status === 'paid') {
      return res.json({ ok: true, duplicate: true });
    }

    const approvedStates = ['paid', 'approved', 'completed', 'success'];
    if (!approvedStates.includes(status)) {
      return res.json({ ok: true, ignored: true, status });
    }

    const newBalance = await updateBalance(recarga.user_id, Number(recarga.amount));
    await run('UPDATE recargas SET status = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?', ['paid', recarga.id]);

    const user = await get('SELECT number FROM users WHERE id = ?', [recarga.user_id]);
    if (sock && user?.number) {
      const jid = `${user.number}@s.whatsapp.net`;
      await sock.sendMessage(jid, {
        text: `✅ Pagamento PIX confirmado!\nValor: R$${Number(recarga.amount).toFixed(
          2
        )}\nNovo saldo: R$${newBalance.toFixed(2)}`,
      });
    }

    logger.info({ txid, amount: recarga.amount }, 'Recarga PIX confirmada');
    return res.json({ ok: true });
  } catch (error) {
    logger.error({ err: error.message }, 'Erro no webhook PIX');
    return res.status(500).json({ error: 'internal_error' });
  }
});

async function bootstrap() {
  await initDatabase();
  sock = await startBot();

  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info(`Servidor iniciado em http://localhost:${port}`);
  });
}

bootstrap();
