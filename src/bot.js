const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const { ensureUser, getUserWithBalance, run } = require('./database/db');
const { menuText, isMenuTrigger, rechargeMenu, formatHistory } = require('./handlers/menu');
const { createOrder } = require('./handlers/pedidos');
const { isAdmin, handleAdminCommand } = require('./handlers/admin');
const { createPixCharge } = require('./services/pushinpay');

const logger = pino({ level: 'info' });

function getTextFromMessage(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  ).trim();
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      logger.info('QR gerado. Escaneie no WhatsApp.');
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.error({ code }, 'Conexão fechada.');
      if (shouldReconnect) {
        startBot();
      }
    }

    if (connection === 'open') {
      logger.info('WhatsApp conectado com sucesso.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === 'status@broadcast') continue;
        if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

        const senderNumber = remoteJid.split('@')[0];
        const text = getTextFromMessage(msg.message);
        if (!text) continue;

        const pushName = msg.pushName || 'Cliente';
        const user = await ensureUser(senderNumber, pushName);
        await run('INSERT INTO mensagens(user_id, direction, message_text) VALUES(?, ?, ?)', [
          user.id,
          'in',
          text,
        ]);

        logger.info({ senderNumber, text }, 'Mensagem recebida');

        if (isAdmin(senderNumber) && text.startsWith('!')) {
          const adminReply = await handleAdminCommand(text, sock);
          if (adminReply) {
            await sock.sendMessage(remoteJid, { text: adminReply }, { quoted: msg });
            await run('INSERT INTO mensagens(user_id, direction, message_text) VALUES(?, ?, ?)', [
              user.id,
              'out',
              adminReply,
            ]);
            logger.info({ senderNumber, adminReply }, 'Resposta admin enviada');
          }
          continue;
        }

        let reply = null;
        if (isMenuTrigger(text)) {
          reply = menuText;
        } else if (['1', '2', '3', '4', '5', '6'].includes(text)) {
          const userWithBalance = await getUserWithBalance(senderNumber);
          reply = await createOrder(userWithBalance, text, sock, remoteJid, msg);
        } else if (text === '7') {
          const userWithBalance = await getUserWithBalance(senderNumber);
          reply = `💰 Seu saldo atual: R$${Number(userWithBalance.balance).toFixed(2)}`;
        } else if (text === '8') {
          reply = rechargeMenu();
        } else if (text === '9') {
          reply = await formatHistory(user.id);
        } else if (['10', '20', '50', '100'].includes(text)) {
          const amount = Number(text);
          const external = `recharge-${user.id}-${Date.now()}`;
          const pix = await createPixCharge(amount, user.name, external);

          await run(
            'INSERT INTO recargas(user_id, txid, amount, pix_code, status) VALUES(?, ?, ?, ?, ?)',
            [user.id, pix.txid, amount, pix.pixCode, 'pending']
          );

          reply = `💳 PIX gerado para recarga de R$${amount}\n\nCopie e pague:\n${pix.pixCode}`;
        } else {
          reply = 'Opção inválida. Envie *menu* para continuar.';
        }

        if (reply) {
          await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
          await run('INSERT INTO mensagens(user_id, direction, message_text) VALUES(?, ?, ?)', [
            user.id,
            'out',
            reply,
          ]);

          logger.info({ senderNumber, reply }, 'Resposta enviada');
        }
      } catch (error) {
        logger.error({ err: error.message }, 'Erro ao processar mensagem');
      }
    }
  });

  return sock;
}

module.exports = {
  startBot,
};
