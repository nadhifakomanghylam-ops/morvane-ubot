require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const path = require("path");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.STRING_SESSION || "");
const prefix = process.env.PREFIX || ".";

const DATA_FILE = path.join(__dirname, "data.json");

// Load data
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { blacklist: [], autoText: "", delay: 10, autoBroadcast: false };
  }
}

// Save data
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

let autoBroadcastInterval = null;

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

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message.message) return;
    if (!message.out) return;

    const text = message.message;
    if (!text.startsWith(prefix)) return;

    const command = text.slice(prefix.length).trim().split(" ")[0].toLowerCase();
    const args = text.slice(prefix.length).trim().split(" ").slice(1);
    const data = loadData();

    // ============ MENU ============
    if (command === "menu") {
      await message.edit({
        message: `╭━━〔 MORVANE UBOT 〕━━╮
👤 USERBOT MENU

📋 DASAR:
├ .menu - Menu utama
├ .ping - Cek kecepatan
├ .info - Info akun
├ .id - Chat ID
├ .say <teks> - Edit pesan
└ .status - Status bot

📢 BROADCAST MANUAL:
├ .broadcast <teks> - Broadcast teks
├ .broadcast - Reply foto+caption
└ .bc <teks> - (alias broadcast)

⚙️ BROADCAST OTOMATIS:
├ .setbc <teks> - Set teks auto
├ .setdelay <detik> - Set jeda (min 10)
├ .onbc - Mulai auto broadcast
├ .offbc - Stop auto broadcast
└ .bcinfo - Info broadcast

🚫 BLACKLIST GRUP:
├ .addbl - Tambah grup ke blacklist
├ .removebl <id> - Hapus dari blacklist
└ .listbl - Lihat daftar blacklist
╰━━━━━━━━━━━━━━━━━━━━━━━━╯`,
      });
    }

    // ============ PING ============
    else if (command === "ping") {
      const start = Date.now();
      await message.edit({ message: " Pong..." });
      const speed = Date.now() - start;
      await message.edit({ message: `🏓 Pong!\n⚡ Speed: ${speed}ms` });
    }

    // ============ SAY ============
    else if (command === "say") {
      if (!args.length) {
        return await message.edit({ message: " Masukkan teks!\nContoh: .say Halo dunia" });
      }
      await message.edit({ message: args.join(" ") });
    }

    // ============ ID ============
    else if (command === "id") {
      await message.edit({ message: `🆔 Chat ID:\n${message.chatId}` });
    }

    // ============ INFO ============
    else if (command === "info") {
      const me = await client.getMe();
      await message.edit({
        message: `👤 ACCOUNT INFO\nNama: ${me.firstName || "-"}\nUsername: @${me.username || "-"}\nID: ${me.id}`,
      });
    }

    // ============ STATUS ============
    else if (command === "status") {
      await message.edit({
        message: `🟢 MORVANE UBOT ONLINE\n⚙️ System: Active\n🤖 Client: GramJS\n📡 Status: Connected`,
      });
    }

    // ============ BROADCAST MANUAL (dengan foto/text) ============
    else if (command === "broadcast" || command === "bc") {
      // Cek apakah reply pesan ada foto/media
      const replyMessage = await message.getReplyMessage();
      
      let broadcastText = args.join(" ");
      let broadcastFile = null;

      // Jika ada reply dengan foto/media
      if (replyMessage && replyMessage.media) {
        broadcastFile = replyMessage.media;
        if (!broadcastText && replyMessage.message) {
          broadcastText = replyMessage.message;
        }
      }

      // Jika tidak ada teks dan tidak ada foto
      if (!broadcastText && !broadcastFile) {
        return await message.edit({
          message: "❌ Masukkan pesan atau reply pesan dengan foto!\n\n📝 Contoh:\n.broadcast Halo semua\n\n📷 Atau reply foto:\n.broadcast Caption foto",
        });
      }

      await message.edit({ message: " Memulai broadcast...\nMohon tunggu..." });

      const dialogs = await client.getDialogs();
      const groups = dialogs.filter((d) => d.isGroup || d.isChannel);
      
      let success = 0;
      let failed = 0;
      let skipped = 0;

      for (const dialog of groups) {
        // Skip blacklist
        if (data.blacklist.includes(dialog.id.toString())) {
          skipped++;
          continue;
        }

        try {
          if (broadcastFile) {
            await client.sendMessage(dialog.id, {
              message: broadcastText || "",
              file: broadcastFile,
            });
          } else {
            await client.sendMessage(dialog.id, { message: broadcastText });
          }
          success++;
        } catch (err) {
          failed++;
        }
      }

      await message.edit({
        message: `✅ BROADCAST SELESAI!

📊 Statistik:
✔️ Berhasil: ${success}
❌ Gagal: ${failed}
⏭️ Dilewati (BL): ${skipped}

📝 Pesan: ${broadcastText || "[FOTO]"}`,
      });
    }

    // ============ SET TEKS BROADCAST OTOMATIS ============
    else if (command === "setbc") {
      if (!args.length) {
        return await message.edit({
          message: `❌ Masukkan teks broadcast otomatis!\n\nContoh: .setbc Halo semua, ini pesan otomatis\n\n📌 Teks sekarang: ${data.autoText || "[belum diset]"}`,
        });
      }
      data.autoText = args.join(" ");
      saveData(data);
      await message.edit({
        message: `✅ Teks broadcast otomatis disimpan!\n\n "${data.autoText}"`,
      });
    }

    // ============ SET DELAY ============
    else if (command === "setdelay") {
      const delay = parseInt(args[0]);
      if (!delay || delay < 10) {
        return await message.edit({
          message: `❌ Delay minimal 10 detik!\n\nContoh: .setdelay 15\n\n📌 Delay sekarang: ${data.delay} detik`,
        });
      }
      data.delay = delay;
      saveData(data);
      await message.edit({
        message: `✅ Delay broadcast diset ${delay} detik!`,
      });
    }

    // ============ MULAI AUTO BROADCAST ============
    else if (command === "onbc") {
      if (!data.autoText) {
        return await message.edit({
          message: "❌ Set teks broadcast dulu dengan .setbc <teks>",
        });
      }
      if (data.autoBroadcast) {
        return await message.edit({ message: "⚠️ Auto broadcast sudah berjalan!" });
      }

      data.autoBroadcast = true;
      saveData(data);

      await message.edit({
        message: `🟢 AUTO BROADCAST AKTIF!

📝 Teks: ${data.autoText}
⏱️ Jeda: ${data.delay} detik
🚫 Blacklist: ${data.blacklist.length} grup

Ketik .offbc untuk menghentikan`,
      });

      // Fungsi broadcast otomatis
      async function doAutoBroadcast() {
        try {
          const dialogs = await client.getDialogs();
          const groups = dialogs.filter((d) => d.isGroup || d.isChannel);
          const currentData = loadData();

          for (const dialog of groups) {
            if (!currentData.autoBroadcast) break;
            if (currentData.blacklist.includes(dialog.id.toString())) continue;

            try {
              await client.sendMessage(dialog.id, { message: currentData.autoText });
            } catch (err) {
              // skip
            }

            // Delay antar pesan
            if (currentData.autoBroadcast) {
              await new Promise((r) => setTimeout(r, currentData.delay * 1000));
            }
          }
        } catch (err) {
          console.error("Auto broadcast error:", err);
        }
      }

      // Jalankan pertama kali
      await doAutoBroadcast();

      // Loop terus menerus
      autoBroadcastInterval = setInterval(async () => {
        const currentData = loadData();
        if (!currentData.autoBroadcast) {
          clearInterval(autoBroadcastInterval);
          return;
        }
        await doAutoBroadcast();
      }, 60000); // Cek setiap 1 menit apakah masih aktif
    }

    // ============ STOP AUTO BROADCAST ============
    else if (command === "offbc") {
      data.autoBroadcast = false;
      saveData(data);
      await message.edit({ message: "🔴 AUTO BROADCAST DIHENTIKAN!" });
    }

    // ============ INFO BROADCAST ============
    else if (command === "bcinfo") {
      await message.edit({
        message: `📊 INFO BROADCAST

🟢 Auto Broadcast: ${data.autoBroadcast ? "AKTIF" : "MATI"}
📝 Teks Auto: ${data.autoText || "[belum diset]"}
⏱️ Delay: ${data.delay} detik
🚫 Blacklist: ${data.blacklist.length} grup

💡 Command:
.setbc <teks> - Set teks
.setdelay <detik> - Set jeda
.onbc - Mulai auto
.offbc - Stop auto`,
      });
    }

    // ============ ADD BLACKLIST GRUP ============
    else if (command === "addbl") {
      const chatId = message.chatId.toString();
      if (data.blacklist.includes(chatId)) {
        return await message.edit({ message: "⚠️ Grup ini sudah ada di blacklist!" });
      }
      data.blacklist.push(chatId);
      saveData(data);
      await message.edit({
        message: `✅ Grup ditambahkan ke blacklist!\n\n🆔 ID: ${chatId}\n🚫 Grup ini tidak akan di-broadcast`,
      });
    }

    // ============ REMOVE BLACKLIST ============
    else if (command === "removebl") {
      const targetId = args[0];
      if (!targetId) {
        return await message.edit({
          message: "❌ Masukkan ID grup!\nContoh: .removebl -1001234567890",
        });
      }
      const idx = data.blacklist.indexOf(targetId);
      if (idx === -1) {
        return await message.edit({ message: "❌ ID tidak ada di blacklist!" });
      }
      data.blacklist.splice(idx, 1);
      saveData(data);
      await message.edit({ message: `✅ ID ${targetId} dihapus dari blacklist!` });
    }

    // ============ LIST BLACKLIST ============
    else if (command === "listbl") {
      if (data.blacklist.length === 0) {
        return await message.edit({ message: " Blacklist kosong!" });
      }
      const list = data.blacklist.map((id, i) => `${i + 1}. ${id}`).join("\n");
      await message.edit({
        message: `🚫 DAFTAR BLACKLIST (${data.blacklist.length}):\n\n${list}\n\n💡 Hapus dengan: .removebl <id>`,
      });
    }
  });
}

startBot();