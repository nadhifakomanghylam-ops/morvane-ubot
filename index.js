require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.STRING_SESSION || "");
const prefix = process.env.PREFIX || ".";

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

async function startBot() {
  console.log("🚀 Starting Morvane UBot...");
  
  await client.start({
    phoneNumber: async () => await input.text("Masukkan nomor Telegram: "),
    password: async () => await input.text("Masukkan password 2FA: "),
    phoneCode: async () => await input.text("Masukkan kode OTP Telegram: "),
    onError: (err) => console.log(err),
  });
  
  console.log("✅ UBot berhasil login!");
  console.log("🤖 Morvane UBot Active!");
  console.log("\n STRING SESSION:");
  console.log(client.session.save());

  // Event handler yang lebih simple
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      
      // Debug log
      console.log("📨 Received message:", message?.message);
      console.log("👤 From:", message?.senderId);
      console.log(" Outgoing:", message?.out);
      
      if (!message || !message.message) return;
      
      const text = message.message;
      
      // Cek prefix
      if (!text.startsWith(prefix)) {
        console.log("❌ No prefix match");
        return;
      }
      
      const command = text.slice(prefix.length).trim().split(" ")[0].toLowerCase();
      const args = text.slice(prefix.length).trim().split(" ").slice(1);
      
      console.log("✅ Command detected:", command);
      
      // COMMAND MENU
      if (command === "menu") {
        await client.sendMessage(message.chatId, {
          message: `╭━━〔 MORVANE UBOT 〕━━╮
👤 USERBOT MENU
 .menu
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
        const msg = await client.sendMessage(message.chatId, { message: "🏓 Pong..." });
        const speed = Date.now() - start;
        await client.editMessage(message.chatId, {
          id: msg.id,
          text: ` Pong!\n⚡ Speed: ${speed}ms`,
        });
      }
      // COMMAND SAY
      else if (command === "say") {
        if (!args.length) {
          await client.sendMessage(message.chatId, {
            message: "❌ Masukkan teks!\nContoh: .say Halo dunia",
          });
          return;
        }
        await client.sendMessage(message.chatId, { message: args.join(" ") });
      }
      // COMMAND ID
      else if (command === "id") {
        await client.sendMessage(message.chatId, {
          message: `🆔 Chat ID:\n${message.chatId}`,
        });
      }
      // COMMAND INFO
      else if (command === "info") {
        const me = await client.getMe();
        await client.sendMessage(message.chatId, {
          message: `👤 ACCOUNT INFO
Nama: ${me.firstName || "-"}
Username: @${me.username || "-"}
ID: ${me.id}`,
        });
      }
      // COMMAND STATUS
      else if (command === "status") {
        await client.sendMessage(message.chatId, {
          message: `🟢 MORVANE UBOT ONLINE
️ System: Active
🤖 Client: GramJS
📡 Status: Connected`,
        });
      }
    } catch (error) {
      console.error("❌ Error:", error);
    }
  }, new NewMessage({}));
  
  console.log(" Listening for messages...");
}

startBot();
