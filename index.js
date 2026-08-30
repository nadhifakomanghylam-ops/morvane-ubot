require("dotenv").config();
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input");
const fs = require("fs");
const path = require("path");

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.STRING_SESSION || "");
const prefix = process.env.PREFIX || ".";

const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { blacklist: [], premium: [], autoText: "", delay: 10, autoBroadcast: false };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

let autoBroadcastInterval = null;

// Coba edit pesan (bisa dilakukan kalau pesan itu milik akun sendiri, misal
// command dikirim lewat Saved Messages oleh owner). Kalau gagal (misal
// pesannya punya user premium lain, bukan milik akun ini), fallback ke reply.
async function respond(message, text) {
  try {
    await message.edit({ text });
  } catch (e) {
    try {
      await message.reply({ message: text });
    } catch (e2) {
      console.error("❌ Gagal membalas pesan:", e2.message);
    }
  }
}

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
  console.log("📡 Session siap. (String Session tidak dicetak ke log demi keamanan.)");

  const me = await client.getMe();
  const myId = me.id.toString();
  console.log(`👤 Logged in as ${me.username ? "@" + me.username : me.firstName || myId} | ID: ${myId}`);

  client.addEventHandler(async (event) => {
    try {
      if (!event || !event.message) return;
      const message = event.message;

      console.log(
        `📩 EVENT MASUK | out: ${message.out} | chat: ${message.chatId ?? "-"} | text: ${message.message || "[media/no text]"}`
      );

      if (!message.message) return;

      const chatIdStr = message.chatId ? message.chatId.toString() : null;
      const senderIdStr = message.senderId ? message.senderId.toString() : null;
      const data = loadData();

      // Owner = command dikirim lewat Saved Messages / akun sendiri.
      // Beberapa update GramJS dapat terbaca sebagai out=false, jadi jangan
      // bergantung pada message.out untuk menentukan pesan milik sendiri.
      const isOwner = chatIdStr === myId;
      const isPremium =
        !isOwner &&
        senderIdStr &&
        Array.isArray(data.premium) &&
        data.premium.includes(senderIdStr);

      // Proses command hanya dari owner atau user premium.
      if (!isOwner && !isPremium) return;

      const text = message.message;
      if (!text.startsWith(prefix)) return;

      const command = text.slice(prefix.length).trim().split(" ")[0].toLowerCase();
      const args = text.slice(prefix.length).trim().split(" ").slice(1);

      // Command yang ngatur akses premium hanya boleh dipakai owner,
      // biar user premium gak bisa nambahin premium lain sembarangan.
      const OWNER_ONLY_COMMANDS = ["addprem", "delprem", "listprem"];
      if (OWNER_ONLY_COMMANDS.includes(command) && !isOwner) return;

      if (command === "menu") {
        await respond(message, `╭━━〔 MORVANE UBOT 〕━━╮
👤 USERBOT MENU

📋 DASAR:
 .menu - Menu utama
├ .ping - Cek kecepatan
├ .info - Info akun
 .id - Chat ID
├ .say <teks> - Edit pesan
└ .status - Status bot

📢 BROADCAST MANUAL:
├ .broadcast <teks> - Broadcast teks
├ .broadcast (reply foto) - Broadcast foto+caption
 .bc <teks> - (alias broadcast)

⚙️ BROADCAST OTOMATIS:
├ .setbc <teks> - Set teks auto
├ .setdelay <detik> - Set jeda (min 10)
├ .onbc - Mulai auto broadcast
├ .offbc - Stop auto broadcast
└ .bcinfo - Info broadcast

 BLACKLIST GRUP:
├ .addbl - Tambah grup ke blacklist
├ .removebl <id> - Hapus dari blacklist
└ .listbl - Lihat daftar blacklist

👑 PREMIUM (owner only):
├ .addprem (reply pesan user) - Kasih akses premium
├ .delprem <id> - Cabut akses premium
└ .listprem - Lihat daftar premium
╰━━━━━━━━━━━━━━━━━━━━━━━━`,);
      } else if (command === "ping") {
        const start = Date.now();
        await respond(message, "🏓 Pong...");
        const speed = Date.now() - start;
        await respond(message, `🏓 Pong!\n Speed: ${speed}ms`);
      } else if (command === "say") {
        if (!args.length) {
          return await respond(message, "❌ Masukkan teks!\nContoh: .say Halo dunia");
        }
        await respond(message, args.join(" "));
      } else if (command === "id") {
        await respond(message, `🆔 Chat ID:\n${message.chatId}`);
      } else if (command === "info") {
        const me = await client.getMe();
        await respond(message, `👤 ACCOUNT INFO\nNama: ${me.firstName || "-"}\nUsername: @${me.username || "-"}\nID: ${me.id}`,);
      } else if (command === "status") {
        await respond(message, `🟢 MORVANE UBOT ONLINE\n️ System: Active\n🤖 Client: GramJS\n📡 Status: Connected`,);
      } else if (command === "broadcast" || command === "bc") {
        const replyMessage = await message.getReplyMessage();
        let broadcastText = args.join(" ");
        let broadcastFile = null;

        if (replyMessage && replyMessage.media) {
          broadcastFile = replyMessage.media;
          if (!broadcastText && replyMessage.message) {
            broadcastText = replyMessage.message;
          }
        }

        if (!broadcastText && !broadcastFile) {
          return await respond(message, "❌ Masukkan pesan atau reply foto!\n\n .broadcast Halo semua\n📷 Reply foto → .broadcast Caption",);
        }

        await respond(message, " Memulai broadcast...\nMohon tunggu...");

        const dialogs = await client.getDialogs();
        const groups = dialogs.filter((d) => d.isGroup || d.isChannel);
        let success = 0, failed = 0, skipped = 0;

        for (const dialog of groups) {
          if (data.blacklist.includes(dialog.id.toString())) { skipped++; continue; }
          try {
            if (broadcastFile) {
              await client.sendMessage(dialog.id, { message: broadcastText || "", file: broadcastFile });
            } else {
              await client.sendMessage(dialog.id, { message: broadcastText });
            }
            success++;
          } catch (err) { failed++; }
        }

        await respond(message, `✅ BROADCAST SELESAI!\n\n📊 Statistik:\n✔️ Berhasil: ${success}\n❌ Gagal: ${failed}\n⏭️ Dilewati (BL): ${skipped}\n\n📝 Pesan: ${broadcastText || "[FOTO]"}`,);
      } else if (command === "setbc") {
        if (!args.length) {
          return await respond(message, `❌ Masukkan teks!\nContoh: .setbc Halo semua\n\n📌 Teks sekarang: ${data.autoText || "[belum diset]"}`);
        }
        data.autoText = args.join(" ");
        saveData(data);
        await respond(message, `✅ Teks broadcast disimpan!\n\n"${data.autoText}"`);
      } else if (command === "setdelay") {
        const delay = parseInt(args[0]);
        if (!delay || delay < 10) {
          return await respond(message, `❌ Delay minimal 10 detik!\n\n📌 Delay sekarang: ${data.delay} detik`);
        }
        data.delay = delay;
        saveData(data);
        await respond(message, `✅ Delay diset ${delay} detik!`);
      } else if (command === "onbc") {
        if (!data.autoText) return await respond(message, "❌ Set teks dulu dengan .setbc <teks>");
        if (data.autoBroadcast) return await respond(message, "⚠️ Auto broadcast sudah berjalan!");

        data.autoBroadcast = true;
        saveData(data);
        await respond(message, `🟢 AUTO BROADCAST AKTIF!\n\n📝 Teks: ${data.autoText}\n⏱️ Jeda: ${data.delay} detik\n🚫 Blacklist: ${data.blacklist.length} grup\n\nKetik .offbc untuk stop`,);

        async function doAutoBroadcast() {
          try {
            const dialogs = await client.getDialogs();
            const groups = dialogs.filter((d) => d.isGroup || d.isChannel);
            const currentData = loadData();
            for (const dialog of groups) {
              if (!currentData.autoBroadcast) break;
              if (currentData.blacklist.includes(dialog.id.toString())) continue;
              try { await client.sendMessage(dialog.id, { message: currentData.autoText }); } catch (err) {}
              if (currentData.autoBroadcast) await new Promise((r) => setTimeout(r, currentData.delay * 1000));
            }
          } catch (err) { console.error("Auto BC error:", err); }
        }

        await doAutoBroadcast();
        autoBroadcastInterval = setInterval(async () => {
          const currentData = loadData();
          if (!currentData.autoBroadcast) { clearInterval(autoBroadcastInterval); return; }
          await doAutoBroadcast();
        }, 60000);
      } else if (command === "offbc") {
        data.autoBroadcast = false;
        saveData(data);
        await respond(message, "🔴 AUTO BROADCAST DIHENTIKAN!");
      } else if (command === "bcinfo") {
        await respond(message, ` INFO BROADCAST\n\n🟢 Auto BC: ${data.autoBroadcast ? "AKTIF" : "MATI"}\n📝 Teks: ${data.autoText || "[belum diset]"}\n⏱️ Delay: ${data.delay} detik\n🚫 Blacklist: ${data.blacklist.length} grup`,);
      } else if (command === "addbl") {
        const chatId = message.chatId.toString();
        if (data.blacklist.includes(chatId)) return await respond(message, "⚠️ Sudah ada di blacklist!");
        data.blacklist.push(chatId);
        saveData(data);
        await respond(message, `✅ Grup ditambahkan ke blacklist!\n🆔 ID: ${chatId}`);
      } else if (command === "removebl") {
        const targetId = args[0];
        if (!targetId) return await respond(message, " Masukkan ID!\nContoh: .removebl -1001234567890");
        const idx = data.blacklist.indexOf(targetId);
        if (idx === -1) return await respond(message, "❌ ID tidak ada di blacklist!");
        data.blacklist.splice(idx, 1);
        saveData(data);
        await respond(message, `✅ ID ${targetId} dihapus dari blacklist!`);
      } else if (command === "listbl") {
        if (data.blacklist.length === 0) return await respond(message, " Blacklist kosong!");
        const list = data.blacklist.map((id, i) => `${i + 1}. ${id}`).join("\n");
        await respond(message, ` DAFTAR BLACKLIST (${data.blacklist.length}):\n\n${list}\n\n Hapus: .removebl <id>`);
      } else if (command === "addprem") {
        const replyMessage = await message.getReplyMessage();
        if (!replyMessage) {
          return await respond(message, "❌ Reply pesan orang yang mau ditambah premium, baru ketik .addprem");
        }
        const targetId = replyMessage.senderId ? replyMessage.senderId.toString() : null;
        if (!targetId) {
          return await respond(message, "❌ Gagal ambil ID user dari pesan yang direply.");
        }
        if (!Array.isArray(data.premium)) data.premium = [];
        if (data.premium.includes(targetId)) {
          return await respond(message, `⚠️ User \`${targetId}\` sudah premium!`);
        }
        data.premium.push(targetId);
        saveData(data);
        await respond(message, `✅ User \`${targetId}\` sekarang PREMIUM!\nDia sekarang bisa pakai command ubot ini langsung dari chat pribadi ke akun ini.`);
      } else if (command === "delprem") {
        const targetId = args[0];
        if (!targetId) return await respond(message, "❌ Masukkan ID!\nContoh: .delprem 8717917279");
        if (!Array.isArray(data.premium)) data.premium = [];
        const idx = data.premium.indexOf(targetId);
        if (idx === -1) return await respond(message, "❌ ID tidak ada di daftar premium!");
        data.premium.splice(idx, 1);
        saveData(data);
        await respond(message, `✅ User \`${targetId}\` dihapus dari premium.`);
      } else if (command === "listprem") {
        const premium = Array.isArray(data.premium) ? data.premium : [];
        if (premium.length === 0) return await respond(message, "📭 Belum ada user premium.");
        const list = premium.map((id, i) => `${i + 1}. ${id}`).join("\n");
        await respond(message, `👑 DAFTAR PREMIUM (${premium.length}):\n\n${list}\n\nHapus: .delprem <id>`);
      }
    } catch (error) {
      console.error("❌ Error:", error);
    }
  }, new NewMessage({}));

  console.log("📡 Message handler aktif!");
  console.log("⏳ Menunggu pesan/command...");

  // client.start() sudah menjalankan koneksi/update loop GramJS.
  // Jangan memanggil runUntilDisconnected() karena method tersebut tidak tersedia
  // pada versi GramJS yang digunakan oleh project ini.
  await new Promise(() => {});
}

startBot().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exitCode = 1;
});
