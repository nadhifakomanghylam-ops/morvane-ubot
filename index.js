require("dotenv").config();
const { TelegramClient, Api } = require("telegram");
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
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    data = {};
  }
  if (!Array.isArray(data.blacklist)) data.blacklist = [];
  if (!Array.isArray(data.premium)) data.premium = [];
  if (typeof data.autoText !== "string") data.autoText = "";
  if (data.autoFile === undefined) data.autoFile = null;
  if (typeof data.delay !== "number") data.delay = 10;
  if (typeof data.autoBroadcast !== "boolean") data.autoBroadcast = false;
  // Konfigurasi auto-reply berbasis keyword (bukan ke semua pesan)
  if (!data.autoReply || typeof data.autoReply !== "object") data.autoReply = {};
  if (!Array.isArray(data.autoReply.keywords)) data.autoReply.keywords = [];
  if (typeof data.autoReply.enabled !== "boolean") data.autoReply.enabled = false;
  if (typeof data.autoReply.intervalSeconds !== "number") data.autoReply.intervalSeconds = 15;
  if (typeof data.autoReply.cooldownMinutes !== "number") data.autoReply.cooldownMinutes = 30;
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

let autoBroadcastInterval = null;
// Simpan hasil broadcast terakhir (manual maupun otomatis) buat command .bclist
let lastBroadcastResult = null;
// State rate-limit auto-reply keyword: jeda global antar balasan + cooldown
// per pengirim, biar gak nge-spam orang yang sama terus-terusan. Disimpan
// di memori aja (reset kalau bot direstart), gak perlu ditulis ke disk.
let lastAutoReplyTime = 0;
const autoReplyCooldownMap = new Map();

// Bikin entity "blockquote" asli Telegram (bar kutip di kiri + ikon kutip),
// bukan cuma ASCII art. Offset/length pakai text.length karena string JS
// sudah dalam satuan UTF-16 code unit, sama seperti yang dipakai Telegram.
function buildQuoteEntities(text) {
  if (!text) return undefined;
  return [new Api.MessageEntityBlockquote({ offset: 0, length: text.length })];
}

// Auto-reply berbasis KEYWORD (bukan ke semua pesan). Cuma jalan kalau
// pesan orang lain di grup/channel mengandung salah satu kata kunci yang
// diset lewat .addkw, dan hormat dua batas: jeda global (intervalSeconds)
// serta cooldown per pengirim (cooldownMinutes) biar gak keliatan spam.
async function handleKeywordAutoReply(message, senderIdStr, data) {
  const ar = data.autoReply;
  if (!ar.enabled) return;
  if (!ar.keywords.length) return;
  if (!data.autoText && !data.autoFile) return; // belum ada konten (pakai .setbc dulu)

  const text = (message.message || "").toLowerCase();
  const matched = ar.keywords.some((kw) => kw && text.includes(kw.toLowerCase()));
  if (!matched) return;

  const now = Date.now();
  if (now - lastAutoReplyTime < ar.intervalSeconds * 1000) return; // masih dalam jeda global
  const lastToSender = autoReplyCooldownMap.get(senderIdStr) || 0;
  if (now - lastToSender < ar.cooldownMinutes * 60000) return; // orang ini baru aja dibales

  const entities = buildQuoteEntities(data.autoText);
  const filePath = data.autoFile ? path.join(__dirname, data.autoFile) : null;
  const fileExists = filePath && fs.existsSync(filePath);

  try {
    if (fileExists) {
      try {
        await message.reply({ message: data.autoText || "", file: filePath, formattingEntities: entities });
      } catch {
        // Grup ini kemungkinan gak izinin kirim media -> fallback teks doang
        await message.reply({ message: data.autoText || "", formattingEntities: entities });
      }
    } else {
      await message.reply({ message: data.autoText, formattingEntities: entities });
    }
    lastAutoReplyTime = now;
    autoReplyCooldownMap.set(senderIdStr, now);
  } catch (err) {
    console.error("❌ Gagal auto-reply keyword:", err.message);
  }
}

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

      const senderIdStr = message.senderId ? message.senderId.toString() : null;
      const data = loadData();

      // Owner = pesan yang DIKIRIM oleh akun ini sendiri, di chat manapun
      // (Saved Messages, DM ke orang lain, dll) — bukan cuma di Saved Messages.
      // Pakai senderId, bukan chatId, karena chatId di private chat selalu
      // merujuk ke lawan bicara, bukan ke pemilik akun.
      const isOwner = senderIdStr === myId;
      const isPremium =
        !isOwner &&
        senderIdStr &&
        Array.isArray(data.premium) &&
        data.premium.includes(senderIdStr);

      // Auto-reply keyword: jalan buat pesan ORANG LAIN (bukan command punya
      // sendiri) di grup/channel. Diproses di sini, SEBELUM early-return di
      // bawah, karena early-return itu cuma buat gerbang command (.broadcast,
      // .setbc, dst) yang memang harus dari owner/premium.
      if (!isOwner && senderIdStr && (message.isGroup || message.isChannel)) {
        handleKeywordAutoReply(message, senderIdStr, data).catch((e) =>
          console.error("Auto-reply error:", e.message)
        );
      }

      // Proses command hanya dari owner atau user premium.
      if (!isOwner && !isPremium) return;

      const text = message.message;
      if (!text.startsWith(prefix)) return;

      // Ambil "kata pertama" sebagai command (berhenti di spasi ATAU enter),
      // sisanya (argsText) dibiarkan utuh termasuk baris barunya — biar
      // command yang butuh teks panjang/multi-baris (.setbc, .say, .broadcast)
      // gak ketangkep berantakan atau ke-duplikat kayak yang kejadian tadi.
      const body = text.slice(prefix.length);
      const firstMatch = body.match(/^(\S+)([\s\S]*)$/);
      const command = firstMatch ? firstMatch[1].toLowerCase() : "";
      const argsText = firstMatch ? firstMatch[2].trim() : "";
      const args = argsText.length ? argsText.split(/\s+/) : [];

      // Command yang ngatur akses premium hanya boleh dipakai owner,
      // biar user premium gak bisa nambahin premium lain sembarangan.
      const OWNER_ONLY_COMMANDS = ["addprem", "delprem", "listprem"];
      if (OWNER_ONLY_COMMANDS.includes(command) && !isOwner) return;

      if (command === "menu") {
        await respond(message, `╭─────────────────╮
   ✨ 𝗠𝗢𝗥𝗩𝗔𝗡𝗘 𝗨𝗕𝗢𝗧 ✨
╰─────────────────╯
🤖 Userbot Menu — pakai prefix "${prefix}"

📋 𝗗𝗔𝗦𝗔𝗥
 ▸ 🏠 .menu — Menu utama
 ▸ 🏓 .ping — Cek kecepatan
 ▸ ℹ️ .info — Info akun
 ▸ 🆔 .id — Chat ID
 ▸ ✏️ .say <teks> — Edit pesan
 ▸ 🟢 .status — Status bot

📢 𝗕𝗥𝗢𝗔𝗗𝗖𝗔𝗦𝗧 𝗠𝗔𝗡𝗨𝗔𝗟
 ▸ 📣 .broadcast <teks> — Broadcast teks
 ▸ 🖼️ .broadcast (reply foto) — Broadcast foto+caption
 ▸ 🔁 .bc <teks> — Alias broadcast

⏱️ 𝗕𝗥𝗢𝗔𝗗𝗖𝗔𝗦𝗧 𝗢𝗧𝗢𝗠𝗔𝗧𝗜𝗦
 ▸ 📝 .setbc <teks> — Set teks auto
 ▸ 📷 .setbc (reply foto) <teks> — Set foto+teks auto
 ▸ ⏳ .setdelay <detik> — Set jeda (min 10)
 ▸ ▶️ .onbc — Mulai auto broadcast
 ▸ ⏹️ .offbc — Stop auto broadcast
 ▸ 📊 .bcinfo — Info broadcast
 ▸ 📋 .bclist — Daftar grup terkirim/gagal/skip

🚫 𝗕𝗟𝗔𝗖𝗞𝗟𝗜𝗦𝗧 𝗚𝗥𝗨𝗣
 ▸ ➕ .addbl — Tambah grup ke blacklist
 ▸ ➖ .removebl <id> — Hapus dari blacklist
 ▸ 📃 .listbl — Lihat daftar blacklist

💬 𝗔𝗨𝗧𝗢-𝗥𝗘𝗣𝗟𝗬 𝗞𝗘𝗬𝗪𝗢𝗥𝗗
 ▸ 🔛 .autoreply on/off — Aktif/matikan
 ▸ ➕ .addkw <kata1,kata2> — Tambah keyword trigger
 ▸ ➖ .delkw <kata> — Hapus keyword
 ▸ 📋 .listkw — Lihat daftar keyword
 ▸ ⏱️ .setarinterval <detik> — Jeda global antar reply
 ▸ 🧊 .setarcooldown <menit> — Cooldown per orang
 ▸ 📊 .arinfo — Info status auto-reply
 (Konten balasan pakai foto+teks dari .setbc)

👑 𝗣𝗥𝗘𝗠𝗜𝗨𝗠 (owner only)
 ▸ 🎟️ .addprem (reply pesan user) — Kasih akses premium
 ▸ ❌ .delprem <id> — Cabut akses premium
 ▸ 📋 .listprem — Lihat daftar premium

🔗 𝗝𝗢𝗜𝗡 𝗚𝗥𝗨𝗣
 ▸ 🚪 .joingc <link> — Join grup biar ikut kena broadcast

╰─────────────────╯
💠 Powered by Morvane UBot`,);
      } else if (command === "ping") {
        const start = Date.now();
        await respond(message, "🏓 Pong...");
        const speed = Date.now() - start;
        await respond(message, `🏓 Pong!\n Speed: ${speed}ms`);
      } else if (command === "say") {
        if (!args.length) {
          return await respond(message, "❌ Masukkan teks!\nContoh: .say Halo dunia");
        }
        await respond(message, argsText);
      } else if (command === "id") {
        await respond(message, `🆔 Chat ID:\n${message.chatId}`);
      } else if (command === "info") {
        const me = await client.getMe();
        await respond(message, `👤 ACCOUNT INFO\nNama: ${me.firstName || "-"}\nUsername: @${me.username || "-"}\nID: ${me.id}`,);
      } else if (command === "status") {
        await respond(message, `🟢 MORVANE UBOT ONLINE\n️ System: Active\n🤖 Client: GramJS\n📡 Status: Connected`,);
      } else if (command === "broadcast" || command === "bc") {
        const replyMessage = await message.getReplyMessage();
        let broadcastText = argsText;
        let broadcastFile = null;

        if (replyMessage && replyMessage.media) {
          broadcastFile = replyMessage.media;
          // Gabung: teks yang ditulis setelah .broadcast + caption asli foto
          // yang direply (bukan saling timpa kayak sebelumnya).
          if (replyMessage.message) {
            broadcastText = argsText
              ? `${argsText}\n\n${replyMessage.message}`
              : replyMessage.message;
          }
        } else if (!broadcastText && replyMessage && replyMessage.message) {
          // Reply ke pesan teks biasa (tanpa media) & tanpa argsText -> pakai
          // teks yang direply.
          broadcastText = replyMessage.message;
        }

        if (!broadcastText && !broadcastFile) {
          return await respond(message, "❌ Masukkan pesan atau reply foto!\n\n .broadcast Halo semua\n📷 Reply foto → .broadcast Caption",);
        }

        await respond(message, " Memulai broadcast...\nMohon tunggu...");

        const quoteEntities = buildQuoteEntities(broadcastText);
        const dialogs = await client.getDialogs();
        const groups = dialogs.filter((d) => d.isGroup || d.isChannel);
        let success = 0, failed = 0, skipped = 0;
        const successList = [], failedList = [], skippedList = [];

        for (const dialog of groups) {
          const idStr = dialog.id.toString();
          const title = dialog.title || dialog.name || "-";
          if (data.blacklist.includes(idStr)) { skipped++; skippedList.push({ id: idStr, title }); continue; }
          try {
            if (broadcastFile) {
              await client.sendMessage(dialog.id, { message: broadcastText || "", file: broadcastFile, formattingEntities: quoteEntities });
            } else {
              await client.sendMessage(dialog.id, { message: broadcastText, formattingEntities: quoteEntities });
            }
            success++;
            successList.push({ id: idStr, title });
          } catch (err) {
            failed++;
            failedList.push({ id: idStr, title, reason: err.message });
          }
        }

        lastBroadcastResult = { success: successList, failed: failedList, skipped: skippedList, timestamp: Date.now() };

        await respond(message, `✅ BROADCAST SELESAI!\n\n📊 Statistik:\n✔️ Berhasil: ${success}\n❌ Gagal: ${failed}\n⏭️ Dilewati (BL): ${skipped}\n\n📝 Pesan: ${broadcastText || "[FOTO]"}\n\nKetik .bclist buat lihat daftar grupnya.`,);
      } else if (command === "setbc") {
        const replyMessage = await message.getReplyMessage();

        if (replyMessage && replyMessage.media) {
          // Mode FOTO + TEKS: gabung teks command dengan caption asli foto,
          // fotonya didownload & disimpan ke disk biar bisa dipakai ulang
          // tiap siklus auto broadcast (dan tetap ada walau bot direstart).
          const combinedText = argsText
            ? replyMessage.message ? `${argsText}\n\n${replyMessage.message}` : argsText
            : replyMessage.message || "";

          try {
            const mediaDir = path.join(__dirname, "media");
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
            const buffer = await client.downloadMedia(replyMessage.media, {});
            const ext = replyMessage.photo ? "jpg" : "bin";
            const relPath = path.join("media", `autobc.${ext}`);
            fs.writeFileSync(path.join(__dirname, relPath), buffer);
            data.autoFile = relPath;
          } catch (err) {
            return await respond(message, `❌ Gagal menyimpan foto: ${err.message}`);
          }

          data.autoText = combinedText;
          saveData(data);
          return await respond(message, `✅ Broadcast otomatis diset dengan FOTO + teks!\n\n📷 Foto tersimpan\n📝 Teks:\n${data.autoText || "[kosong]"}`,);
        }

        // Mode teks biasa (tanpa reply foto) -> reset foto yang lama (kalau ada)
        if (!args.length) {
          return await respond(message, `❌ Masukkan teks, atau reply foto buat mode foto+teks!\nContoh: .setbc Halo semua\n\n📌 Teks sekarang: ${data.autoText || "[belum diset]"}\n📷 Foto sekarang: ${data.autoFile ? "Ada" : "Tidak ada"}`);
        }
        data.autoText = argsText;
        data.autoFile = null;
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
            const entities = buildQuoteEntities(currentData.autoText);
            const filePath = currentData.autoFile ? path.join(__dirname, currentData.autoFile) : null;
            const fileExists = filePath && fs.existsSync(filePath);
            const runResult = { success: [], failed: [], skipped: [], timestamp: Date.now() };

            for (const dialog of groups) {
              if (!currentData.autoBroadcast) break;
              const idStr = dialog.id.toString();
              const title = dialog.title || dialog.name || "-";
              if (currentData.blacklist.includes(idStr)) {
                runResult.skipped.push({ id: idStr, title });
                continue;
              }
              try {
                if (fileExists) {
                  await client.sendMessage(dialog.id, { message: currentData.autoText || "", file: filePath, formattingEntities: entities });
                } else {
                  await client.sendMessage(dialog.id, { message: currentData.autoText, formattingEntities: entities });
                }
                runResult.success.push({ id: idStr, title });
              } catch (err) {
                runResult.failed.push({ id: idStr, title, reason: err.message });
              }
              if (currentData.autoBroadcast) await new Promise((r) => setTimeout(r, currentData.delay * 1000));
            }
            lastBroadcastResult = runResult;
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
        await respond(message, ` INFO BROADCAST\n\n🟢 Auto BC: ${data.autoBroadcast ? "AKTIF" : "MATI"}\n📷 Foto: ${data.autoFile ? "Ada" : "Tidak ada"}\n📝 Teks: ${data.autoText || "[belum diset]"}\n⏱️ Delay: ${data.delay} detik\n🚫 Blacklist: ${data.blacklist.length} grup`,);
      } else if (command === "bclist") {
        if (!lastBroadcastResult) {
          return await respond(message, "📭 Belum ada history broadcast. Jalankan .broadcast / .bc atau .onbc dulu.");
        }
        const { success, failed, skipped, timestamp } = lastBroadcastResult;
        const fmtList = (arr) => (arr.length ? arr.map((g, i) => `${i + 1}. ${g.title} (${g.id})${g.reason ? ` — ${g.reason}` : ""}`).join("\n") : "-");

        let text = `📊 HASIL BROADCAST TERAKHIR\n🕒 ${new Date(timestamp).toLocaleString("id-ID")}\n\n`;
        text += `✅ TERKIRIM (${success.length}):\n${fmtList(success)}\n\n`;
        text += `❌ GAGAL (${failed.length}):\n${fmtList(failed)}\n\n`;
        text += `⏭️ DILEWATI/BLACKLIST (${skipped.length}):\n${fmtList(skipped)}`;

        // Batasi panjang biar gak kena limit pesan Telegram (4096 karakter)
        if (text.length > 4000) text = text.slice(0, 3950) + "\n\n... (dipotong, kepanjangan)";
        await respond(message, text);
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
      } else if (command === "autoreply") {
        const mode = (args[0] || "").toLowerCase();
        if (mode !== "on" && mode !== "off") {
          return await respond(message, `❌ Pakai: .autoreply on / .autoreply off\n\n📌 Status sekarang: ${data.autoReply.enabled ? "AKTIF" : "MATI"}`);
        }
        data.autoReply.enabled = mode === "on";
        saveData(data);
        await respond(message, `✅ Auto-reply keyword sekarang ${data.autoReply.enabled ? "AKTIF 🟢" : "MATI 🔴"}`);
      } else if (command === "addkw") {
        if (!argsText) return await respond(message, "❌ Masukkan kata kunci!\nContoh: .addkw harga,minat,info produk");
        const newKeywords = argsText.split(",").map((k) => k.trim()).filter(Boolean);
        let added = 0;
        for (const kw of newKeywords) {
          if (!data.autoReply.keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
            data.autoReply.keywords.push(kw);
            added++;
          }
        }
        saveData(data);
        await respond(message, `✅ ${added} keyword ditambahkan!\n\n📋 Daftar sekarang:\n${data.autoReply.keywords.join(", ") || "-"}`);
      } else if (command === "delkw") {
        if (!argsText) return await respond(message, "❌ Masukkan kata kunci yang mau dihapus!\nContoh: .delkw harga");
        const before = data.autoReply.keywords.length;
        data.autoReply.keywords = data.autoReply.keywords.filter((k) => k.toLowerCase() !== argsText.toLowerCase());
        saveData(data);
        const removed = before - data.autoReply.keywords.length;
        await respond(message, removed ? `✅ Keyword "${argsText}" dihapus!` : `❌ Keyword "${argsText}" tidak ditemukan.`);
      } else if (command === "listkw") {
        const kws = data.autoReply.keywords;
        await respond(message, kws.length ? `📋 DAFTAR KEYWORD (${kws.length}):\n${kws.map((k, i) => `${i + 1}. ${k}`).join("\n")}` : "📭 Belum ada keyword. Tambah dengan .addkw <kata>");
      } else if (command === "setarinterval") {
        const sec = parseInt(args[0]);
        if (!sec || sec < 5) return await respond(message, `❌ Interval minimal 5 detik!\n\n📌 Sekarang: ${data.autoReply.intervalSeconds} detik`);
        data.autoReply.intervalSeconds = sec;
        saveData(data);
        await respond(message, `✅ Jeda antar auto-reply diset ${sec} detik (berlaku global, ke semua grup)`);
      } else if (command === "setarcooldown") {
        const min = parseInt(args[0]);
        if (!min || min < 1) return await respond(message, `❌ Cooldown minimal 1 menit!\n\n📌 Sekarang: ${data.autoReply.cooldownMinutes} menit`);
        data.autoReply.cooldownMinutes = min;
        saveData(data);
        await respond(message, `✅ Cooldown per orang diset ${min} menit (gak bakal dibales berkali-kali dalam rentang ini)`);
      } else if (command === "arinfo") {
        const ar = data.autoReply;
        await respond(message, `🤖 INFO AUTO-REPLY KEYWORD\n\n🟢 Status: ${ar.enabled ? "AKTIF" : "MATI"}\n🔑 Keyword (${ar.keywords.length}): ${ar.keywords.join(", ") || "-"}\n⏱️ Jeda global: ${ar.intervalSeconds} detik\n🧊 Cooldown per orang: ${ar.cooldownMinutes} menit\n📦 Konten: ${data.autoFile ? "Foto + teks (dari .setbc)" : data.autoText ? "Teks saja (dari .setbc)" : "❌ Belum diset, pakai .setbc dulu"}`);
      } else if (command === "joingc") {
        const link = args[0];
        if (!link) {
          return await respond(message, "❌ Masukkan link/username grup!\nContoh:\n.joingc https://t.me/+abcdef\n.joingc namagrup");
        }
        try {
          if (link.includes("+") || link.includes("joinchat")) {
            // Private invite link, contoh: https://t.me/+abcdef atau t.me/joinchat/abcdef
            const hash = link.split(/\+|joinchat\//).pop().replace(/\/$/, "");
            await client.invoke(new Api.messages.ImportChatInvite({ hash }));
          } else {
            // Grup/channel publik, contoh: https://t.me/namagrup atau @namagrup
            const username = link.replace("https://t.me/", "").replace("@", "").replace(/\/$/, "");
            await client.invoke(new Api.channels.JoinChannel({ channel: username }));
          }
          await respond(message, "✅ Berhasil join grup! Grup ini sekarang otomatis ikut kena broadcast.");
        } catch (err) {
          await respond(message, `❌ Gagal join grup: ${err.message}`);
        }
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
