const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const fs = require("fs");
const readline = require("readline");

const DATA_FILE = "./data.json";

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        totalKas: 26000,
        saldo: {},
        rekap: []
      };
    }

    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    console.log("Gagal membaca data.json:", e);
    return {
      totalKas: 26000,
      saldo: {},
      rekap: []
    };
  }
}

let data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function rupiah(n) {
  return "Rp" + Number(n || 0).toLocaleString("id-ID");
}

function parseNominal(text) {
  if (!text) return null;

  text = text
    .toLowerCase()
    .replace(/rp/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");

  let multiplier = 1;

  if (text.endsWith("jt")) {
    multiplier = 1000000;
    text = text.slice(0, -2);
  } else if (text.endsWith("juta")) {
    multiplier = 1000000;
    text = text.slice(0, -4);
  } else if (text.endsWith("k")) {
    multiplier = 1000;
    text = text.slice(0, -1);
  } else if (text.endsWith("rb")) {
    multiplier = 1000;
    text = text.slice(0, -2);
  }

  const number = parseFloat(text);

  if (isNaN(number)) return null;

  return Math.round(number * multiplier);
}

function getMentionedUsers(msg) {
  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    {};

  return context.mentionedJid || [];
}

function getText(msg) {
  const m = msg.message;

  if (!m) return "";

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

function ensureUser(jid, name = null) {
  if (!data.saldo[jid]) {
    data.saldo[jid] = {
      nama: name || jid.split("@")[0],
      saldo: 0
    };
  }

  if (name) {
    data.saldo[jid].nama = name;
  }
}

function formatUser(jid) {
  return `@${jid.split("@")[0]}`;
}

function userList() {
  const users = Object.entries(data.saldo);

  if (!users.length) {
    return "Belum ada data saldo.";
  }

  return users
    .map(([jid, user]) => {
      return `${formatUser(jid)} : ${rupiah(user.saldo)}`;
    })
    .join("\n");
}

function addHistory(type, users, amount, totalAfter) {
  data.rekap.push({
    waktu: new Date().toISOString(),
    type,
    users,
    amount,
    totalKas: totalAfter
  });

  // Batasi history agar data tidak terlalu besar
  if (data.rekap.length > 500) {
    data.rekap = data.rekap.slice(-500);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["GENTA KAS BOT", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // LOGIN PAIRING
  if (!sock.authState.creds.registered) {
    const phoneNumber = process.env.WA_NUMBER;

    if (!phoneNumber) {
      console.log("");
      console.log("=================================");
      console.log(" WA_NUMBER belum diisi!");
      console.log("=================================");
      console.log("");
      console.log("Contoh:");
      console.log("WA_NUMBER=628123456789");
      console.log("");
      process.exit(1);
    }

    const cleanNumber = phoneNumber.replace(/\D/g, "");

    try {
      await new Promise(resolve => setTimeout(resolve, 3000));

      const code = await sock.requestPairingCode(cleanNumber);

      console.log("");
      console.log("=================================");
      console.log("      WHATSAPP PAIRING CODE");
      console.log("=================================");
      console.log("");
      console.log(` Nomor : ${cleanNumber}`);
      console.log(` CODE  : ${code}`);
      console.log("");
      console.log("WhatsApp > Perangkat tertaut");
      console.log("> Tautkan perangkat");
      console.log("> Tautkan dengan nomor telepon");
      console.log("");
      console.log("=================================");
      console.log("");
    } catch (err) {
      console.log("Gagal mendapatkan pairing code:");
      console.log(err);
    }
  }

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("");
      console.log("=================================");
      console.log(" WhatsApp berhasil tersambung!");
      console.log(" GENTA KAS BOT ONLINE");
      console.log("=================================");
      console.log("");
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log("Koneksi WhatsApp terputus.");

      if (shouldReconnect) {
        console.log("Mencoba reconnect...");
        startBot();
      } else {
        console.log("Session logout. Hapus folder auth lalu login ulang.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg || msg.key.fromMe) return;

      const jid = msg.key.remoteJid;

      if (!jid || jid === "status@broadcast") return;

      const text = getText(msg).trim();

      if (!text) return;

      const command = text.split(/\s+/)[0].toLowerCase();

      // =========================
      // START
      // =========================

      if (command === "/start") {
        const help = `
╭━━━〔 💰 GENTA KAS 〕━━━╮
┃
┃ /rekap
┃ /total
┃ /saldo
┃
┃ /tambah @user @user +4k
┃ /minus @user @user -2k
┃
┃ /setkas 26k
┃ /riwayat
┃ /reset
┃ /help
┃
╰━━━━━━━━━━━━━━━━━━━━╯
`;

        await sock.sendMessage(jid, {
          text: help
        });

        return;
      }

      // =========================
      // HELP
      // =========================

      if (command === "/help") {
        await sock.sendMessage(jid, {
          text:
`💰 *GENTA KAS BOT*

Command:

/start
/rekap
/total
/saldo

Tambah saldo:
 /tambah @bayu @asen +4k

Nominal Rp4.000 akan dibagi rata:
 @bayu +Rp2.000
 @asen +Rp2.000

Kurangi saldo:
 /minus @asen @galih -2k

Masing-masing dikurangi Rp2.000.

Set saldo kas awal:
 /setkas 26k

Lihat riwayat:
 /riwayat

Reset:
 /reset`
        });

        return;
      }

      // =========================
      // TOTAL
      // =========================

      if (command === "/total" || command === "/totalsaldo") {
        await sock.sendMessage(jid, {
          text:
`💰 *TOTAL KAS*

${rupiah(data.totalKas)}

👥 Jumlah orang:
${Object.keys(data.saldo).length}`
        });

        return;
      }

      // =========================
      // SALDO
      // =========================

      if (command === "/saldo") {
        const mentions = [];

        for (const [userJid, user] of Object.entries(data.saldo)) {
          mentions.push(userJid);
        }

        let message = `💳 *SALDO PER ORANG*\n\n${userList()}\n\n💰 Total kas: ${rupiah(data.totalKas)}`;

        await sock.sendMessage(jid, {
          text: message,
          mentions
        });

        return;
      }

      // =========================
      // REKAP
      // =========================

      if (command === "/rekap") {
        let output = `💰 *REKAP KAS*\n\n`;
        output += `Saldo kas: *${rupiah(data.totalKas)}*\n\n`;

        if (!data.rekap.length) {
          output += "Belum ada transaksi.\n";
        } else {
          data.rekap.slice(-20).forEach((r, i) => {
            const tanda = r.type === "tambah" ? "➕" : "➖";

            output += `${tanda} *${r.type.toUpperCase()}*\n`;

            for (const u of r.users) {
              output += `• ${formatUser(u)} ${r.type === "tambah" ? "+" : "-"}${rupiah(r.amount)}\n`;
            }

            output += `Total kas: ${rupiah(r.totalKas)}\n\n`;
          });
        }

        output += `━━━━━━━━━━━━━━\n`;
        output += `*SALDO ORANG*\n\n`;
        output += userList();

        const mentions = Object.keys(data.saldo);

        await sock.sendMessage(jid, {
          text: output,
          mentions
        });

        return;
      }

      // =========================
      // SET KAS
      // =========================

      if (command === "/setkas") {
        const args = text.split(/\s+/);

        if (!args[1]) {
          await sock.sendMessage(jid, {
            text: "Contoh:\n/setkas 26k"
          });

          return;
        }

        const nominal = parseNominal(args[1]);

        if (nominal === null) {
          await sock.sendMessage(jid, {
            text: "Nominal tidak valid."
          });

          return;
        }

        data.totalKas = nominal;

        saveData();

        await sock.sendMessage(jid, {
          text: `✅ Saldo kas diubah menjadi *${rupiah(nominal)}*`
        });

        return;
      }

      // =========================
      // TAMBAH
      // =========================

      if (command === "/tambah") {
        const mentions = getMentionedUsers(msg);

        if (!mentions.length) {
          await sock.sendMessage(jid, {
            text:
`❌ Tidak ada orang yang ditandai.

Contoh:
 /tambah @bayu @asen +4k`
          });

          return;
        }

        const args = text.split(/\s+/);

        let nominalText = args.find(x => {
          return /[0-9]+(?:[.,][0-9]+)?(?:k|rb|jt|juta)?/i.test(x);
        });

        if (!nominalText) {
          await sock.sendMessage(jid, {
            text: "Nominal tidak ditemukan.\n\nContoh: /tambah @bayu @asen +4k"
          });

          return;
        }

        const nominal = parseNominal(nominalText.replace("+", ""));

        if (!nominal || nominal <= 0) {
          await sock.sendMessage(jid, {
            text: "Nominal tidak valid."
          });

          return;
        }

        const perPerson = Math.floor(nominal / mentions.length);

        const sisa = nominal - perPerson * mentions.length;

        for (const userJid of mentions) {
          ensureUser(userJid);

          data.saldo[userJid].saldo += perPerson;
        }

        data.totalKas += nominal;

        addHistory(
          "tambah",
          mentions,
          perPerson,
          data.totalKas
        );

        saveData();

        let output =
`✅ *KAS BERTAMBAH*

💰 Masuk: ${rupiah(nominal)}
👥 Orang: ${mentions.length}
💵 Per orang: ${rupiah(perPerson)}`;

        if (sisa > 0) {
          output += `\n⚠️ Sisa pembagian: ${rupiah(sisa)}`;
        }

        output += `\n\n`;

        for (const userJid of mentions) {
          output += `${formatUser(userJid)} +${rupiah(perPerson)}\n`;
        }

        output += `\n💰 Total kas: *${rupiah(data.totalKas)}*`;

        await sock.sendMessage(jid, {
          text: output,
          mentions
        });

        return;
      }

      // =========================
      // MINUS
      // =========================

      if (command === "/minus") {
        const mentions = getMentionedUsers(msg);

        if (!mentions.length) {
          await sock.sendMessage(jid, {
            text:
`❌ Tidak ada orang yang ditandai.

Contoh:
 /minus @asen @galih -2k`
          });

          return;
        }

        const args = text.split(/\s+/);

        let nominalText = args.find(x => {
          return /-?[0-9]+(?:[.,][0-9]+)?(?:k|rb|jt|juta)?/i.test(x);
        });

        if (!nominalText) {
          await sock.sendMessage(jid, {
            text: "Nominal tidak ditemukan.\n\nContoh: /minus @asen @galih -2k"
          });

          return;
        }

        const nominal = parseNominal(
          nominalText.replace("-", "")
        );

        if (!nominal || nominal <= 0) {
          await sock.sendMessage(jid, {
            text: "Nominal tidak valid."
          });

          return;
        }

        const totalPengurangan = nominal * mentions.length;

        for (const userJid of mentions) {
          ensureUser(userJid);

          data.saldo[userJid].saldo -= nominal;
        }

        data.totalKas -= totalPengurangan;

        addHistory(
          "minus",
          mentions,
          nominal,
          data.totalKas
        );

        saveData();

        let output =
`💸 *KAS DIKURANGI*

👥 Orang: ${mentions.length}
💵 Masing-masing: -${rupiah(nominal)}
📉 Total pengurangan: -${rupiah(totalPengurangan)}

`;

        for (const userJid of mentions) {
          output += `${formatUser(userJid)} -${rupiah(nominal)}\n`;
        }

        output += `\n💰 Total kas: *${rupiah(data.totalKas)}*`;

        await sock.sendMessage(jid, {
          text: output,
          mentions
        });

        return;
      }

      // =========================
      // RIWAYAT
      // =========================

      if (command === "/riwayat") {
        if (!data.rekap.length) {
          await sock.sendMessage(jid, {
            text: "📭 Belum ada riwayat transaksi."
          });

          return;
        }

        let output = "📜 *RIWAYAT TRANSAKSI*\n\n";

        data.rekap.slice(-30).forEach((r, i) => {
          const tanggal = new Date(r.waktu).toLocaleString("id-ID");

          output += `${i + 1}. ${r.type === "tambah" ? "➕" : "➖"} ${r.type.toUpperCase()}\n`;
          output += `🕐 ${tanggal}\n`;

          for (const userJid of r.users) {
            output += `• ${formatUser(userJid)} ${r.type === "tambah" ? "+" : "-"}${rupiah(r.amount)}\n`;
          }

          output += `💰 Total: ${rupiah(r.totalKas)}\n\n`;
        });

        await sock.sendMessage(jid, {
          text: output,
          mentions: Object.keys(data.saldo)
        });

        return;
      }

      // =========================
      // RESET
      // =========================

      if (command === "/reset") {
        data = {
          totalKas: 0,
          saldo: {},
          rekap: []
        };

        saveData();

        await sock.sendMessage(jid, {
          text:
`♻️ *DATA DI-RESET*

Total kas: Rp0
Saldo orang: kosong
Riwayat: kosong`
        });

        return;
      }

    } catch (err) {
      console.log("Error message:", err);
    }
  });
}

startBot().catch(err => {
  console.error("Fatal error:", err);
});
