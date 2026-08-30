require("dotenv").config();

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.STRING_SESSION || "");

const prefix = process.env.PREFIX || ".";

const client = new TelegramClient(
  stringSession,
  apiId,
  apiHash,
  {
    connectionRetries: 5,
  }
);

async function startBot() {
  console.log("🚀 Starting Morvane UBot...");

  await client.start({
    phoneNumber: async () =>
      await input.text("Masukkan nomor Telegram: "),

    password: async () =>
      await input.text("Masukkan password 2FA: "),

    phoneCode: async () =>
      await input.text("Masukkan kode OTP Telegram: "),

    onError: (err) => console.log(err),
  });

  console.log("✅ UBot berhasil login!");
  console.log("🤖 Morvane UBot Active!");

  // Simpan session
  console.log("\n📌 STRING SESSION:");
  console.log(client.session.save());

  client.addEventHandler(async (event) => {
    const message = event.message;

    if (!message.message) return;

    // Hanya membaca pesan dari akun sendiri
    if (!message.out) return;

    const text = message.message;

    if (!text.startsWith(prefix)) return;

    const command = text
      .slice(prefix.length)
      .trim()
      .split(" ")[0]
      .toLowerCase();

    const args = text
      .slice(prefix.length)
      .trim()
      .split(" ")
      .slice(1);

    // COMMAND MENU
    if (command === "menu") {
      await message.edit({
        message: `╭━━〔 MORVANE UBOT 〕━━╮

👤 USERBOT MENU
├ .menu
├ .ping
├ .info
├ .id
├ .say <text>
└ .status

╰━━━━━━━━━━━━━━━━╯`,
      });
    }

    // COMMAND PING
    else if (command === "ping") {
      const start = Date.now();

      await message.edit({
        message: "🏓 Pong...",
      });

      const speed = Date.now() - start;

      await message.edit({
        message: `🏓 Pong!\n⚡ Speed: ${speed} ms`,
      });
    }

    // COMMAND SAY
    else if (command === "say") {
      if (!args.length) {
        return await message.edit({
          message: "❌ Masukkan teks!\nContoh: .say Halo dunia",
        });
      }

      await message.edit({
        message: args.join(" "),
      });
    }

    // COMMAND ID
    else if (command === "id") {
      await message.edit({
        message: `🆔 Chat ID:\n${message.chatId}`,
      });
    }

    // COMMAND INFO
    else if (command === "info") {
      const me = await client.getMe();

      await message.edit({
        message: `👤 ACCOUNT INFO

Nama: ${me.firstName || "-"}
Username: @${me.username || "-"}
ID: ${me.id}`,
      });
    }

    // COMMAND STATUS
    else if (command === "status") {
      await message.edit({
        message: `🟢 MORVANE UBOT ONLINE

⚙️ System: Active
🤖 Client: GramJS
📡 Status: Connected`,
      });
    }
  });
}

startBot();