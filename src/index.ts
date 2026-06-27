import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.videogen.web.id';
const RESELLER_API_KEY = process.env.RESELLER_API_KEY || '';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required in .env');
  process.exit(1);
}
if (!RESELLER_API_KEY) {
  console.error('RESELLER_API_KEY is required in .env');
  process.exit(1);
}

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_IDS.length === 0) {
  console.error('ADMIN_IDS is required in .env (comma-separated usernames or IDs)');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': RESELLER_API_KEY,
};

// ── Members Database ──

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const MEMBERS_FILE = path.resolve(DATA_DIR, 'members.json');

interface Member {
  id: number;
  username?: string;
  addedAt: string;
  addedBy: number;
}

function loadMembers(): Member[] {
  try {
    if (fs.existsSync(MEMBERS_FILE)) {
      return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveMembers(members: Member[]) {
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, 2));
}

function isAdmin(userId: number, username?: string): boolean {
  const idStr = String(userId);
  const name = (username || '').toLowerCase();
  return ADMIN_IDS.some(a => a === idStr || a === name);
}

function isMember(userId: number): boolean {
  const members = loadMembers();
  return members.some(m => m.id === userId);
}

// ── Authorization guard ──

async function requireAuth(ctx: any, next: () => Promise<void>) {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;

  if (!userId) return;

  if (isAdmin(userId, username)) {
    return next();
  }

  if (isMember(userId)) {
    return next();
  }

  await ctx.reply(
    '⛔ *Akses Ditolak*\n\n' +
    'Kamu belum terdaftar sebagai anggota SWDIO Bot.\n' +
    'Silakan hubungi admin untuk pendaftaran.',
    { parse_mode: 'Markdown' }
  );
}

// ── Models ──

interface ModelInfo {
  model: string;
  label: string;
  description: string;
  type: string;
  category: string;
  needs_image: boolean;
  supports_image: boolean;
  durations?: number[];
  resolutions?: string[] | null;
  aspect_ratios?: string[];
}

let modelsCache: { video: ModelInfo[]; image: ModelInfo[] } | null = null;

async function fetchModels(): Promise<{ video: ModelInfo[]; image: ModelInfo[] }> {
  const res = await fetch(`${API_BASE_URL}/api/reseller/models`, { headers });
  const data = await res.json();
  const all: ModelInfo[] = [...(data.server1?.video || []), ...(data.server2?.video || []), ...(data.server1?.image || []), ...(data.server2?.image || [])];
  return {
    video: all.filter(m => m.category === 'video'),
    image: all.filter(m => m.category === 'image'),
  };
}

async function getModels(): Promise<{ video: ModelInfo[]; image: ModelInfo[] }> {
  if (!modelsCache) {
    modelsCache = await fetchModels();
  }
  return modelsCache;
}

async function generateMedia(params: {
  model: string;
  prompt: string;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  image_url?: string;
}): Promise<{ job_id: string; status: string; url?: string } | { error: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  return await res.json();
}

async function checkJob(jobId: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`, { headers });
  return await res.json();
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForResult(jobId: string, maxPolls = 60): Promise<string | null> {
  for (let i = 0; i < maxPolls; i++) {
    const data = await checkJob(jobId);
    const status = data.status || '';
    if (['success', 'done', 'completed'].includes(status)) {
      return data.url || data.resultUrl || data.imageUrl || data.image_url || null;
    }
    if (['failed', 'error'].includes(status)) {
      return null;
    }
    await sleep(3000);
  }
  return null;
}

// ── Main Menu Keyboard ──

function getMainKeyboard(isAdminUser: boolean) {
  const rows: any[][] = [
    [Markup.button.text('✨ Buat Video'), Markup.button.text('🎨 Buat Image')],
    [Markup.button.text('📋 Daftar Model')],
  ];
  if (isAdminUser) {
    rows.push([Markup.button.text('👑 Panel Admin')]);
  }
  return Markup.keyboard(rows).resize();
}

// ── Start & Help ──

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const admin = isAdmin(userId, username);
  const member = isMember(userId);

  if (!admin && !member) {
    return ctx.reply(
      '⛔ *Akses Ditolak*\n\n' +
      'Kamu belum terdaftar sebagai anggota SWDIO Bot.\n' +
      'Silakan hubungi admin untuk pendaftaran.',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.replyWithPhoto(
    { url: 'https://img.icons8.com/fluency/96/null/video.png' },
    {
      caption:
        `🎬 *Selamat datang di SWDIO Bot\\!*\n\n` +
        `Bot AI untuk generate *video* dan *image* kualitas tinggi\\.\n\n` +
        `👇 Pilih menu di bawah untuk memulai:`,
      parse_mode: 'MarkdownV2',
      ...getMainKeyboard(admin),
    }
  );
});

bot.help(async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username) && !isMember(ctx.from.id)) return;

  await ctx.reply(
    '💡 *Cara Penggunaan:*\n\n' +
    '‣ Klik *"✨ Buat Video"* untuk generate video\n' +
    '‣ Klik *"🎨 Buat Image"* untuk generate gambar\n' +
    '‣ Klik *"📋 Daftar Model"* untuk lihat model AI\n\n' +
    'Ada pertanyaan? Hubungi admin.',
    { parse_mode: 'Markdown', ...getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)) }
  );
});

// ── Show Models (shared) ──

async function showVideoModels(ctx: any) {
  const { video } = await getModels();
  const buttons = video.map(m => [
    Markup.button.callback(`${m.label}`, `video_${m.model}`),
  ]);
  const perRow: any[] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    perRow.push([...buttons[i], ...(buttons[i + 1] ? buttons[i + 1] : [])].flat());
  }
  perRow.push([Markup.button.callback('🔙 Kembali', 'back_menu')]);
  await ctx.reply('🎬 *Pilih Model Video:*\n\nKlik salah satu model di bawah:', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: perRow },
  });
}

async function showImageModels(ctx: any) {
  const { image } = await getModels();
  const buttons = image.map(m => [
    Markup.button.callback(`${m.label}`, `image_${m.model}`),
  ]);
  const perRow: any[] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    perRow.push([...buttons[i], ...(buttons[i + 1] ? buttons[i + 1] : [])].flat());
  }
  perRow.push([Markup.button.callback('🔙 Kembali', 'back_menu')]);
  await ctx.reply('🎨 *Pilih Model Image:*\n\nKlik salah satu model di bawah:', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: perRow },
  });
}

// ── Text menu handlers ──

bot.hears('✨ Buat Video', requireAuth, async (ctx) => showVideoModels(ctx));

bot.hears('🎨 Buat Image', requireAuth, async (ctx) => showImageModels(ctx));

bot.hears('📋 Daftar Model', requireAuth, async (ctx) => {
  await ctx.reply('📡 Mengambil daftar model...');
  try {
    const { video, image } = await getModels();
    let msg = '🎬 *Model Video:*\n';
    for (const m of video) {
      msg += `▸ *${m.label}* — \`${m.model}\`\n  ${m.description}\n\n`;
    }
    msg += '\n🎨 *Model Image:*\n';
    for (const m of image) {
      msg += `▸ *${m.label}* — \`${m.model}\`\n  ${m.description}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', ...getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)) });
  } catch (e: any) {
    await ctx.reply(`❌ Gagal mengambil model: ${e.message}`);
  }
});

// ── Admin Panel ──

bot.hears('👑 Panel Admin', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  if (!isAdmin(userId, username)) {
    return ctx.reply('⛔ Hanya admin yang bisa mengakses panel ini.');
  }

  const members = loadMembers();
  await ctx.reply(
    `👑 *Panel Admin SWDIO Bot*\n\n` +
    `Total anggota: *${members.length}* orang\n\n` +
    `Pilih menu di bawah:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('➕ Tambah Anggota', 'admin_add')],
          [Markup.button.callback('➖ Hapus Anggota', 'admin_remove')],
          [Markup.button.callback('📋 Daftar Anggota', 'admin_list')],
          [Markup.button.callback('🔙 Tutup', 'admin_close')],
        ],
      },
    }
  );
});

bot.action('admin_add', async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username)) return;
  await ctx.editMessageText(
    '➕ *Tambah Anggota*\n\n' +
    'Kirim *username* Telegram atau *ID numerik* anggota yang ingin ditambahkan.\n\n' +
    'Contoh: `@username` atau `123456789`\n' +
    'Atau forward pesan dari anggota tersebut ke bot ini.',
    { parse_mode: 'Markdown' }
  );
  adminAction.set(ctx.from.id, 'add');
});

bot.action('admin_remove', async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username)) return;
  const members = loadMembers();
  if (members.length === 0) {
    return ctx.editMessageText('📭 Belum ada anggota terdaftar.');
  }
  const buttons = members.map(m => [
    Markup.button.callback(
      `${m.username ? '@' + m.username : m.id}`,
      `remove_${m.id}`
    ),
  ]);
  buttons.push([Markup.button.callback('🔙 Kembali', 'admin_panel')]);
  await ctx.editMessageText('➖ *Pilih anggota yang akan dihapus:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });
});

bot.action(/^remove_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username)) return;
  const removeId = parseInt(ctx.match[1]);
  let members = loadMembers();
  const member = members.find(m => m.id === removeId);
  members = members.filter(m => m.id !== removeId);
  saveMembers(members);
  modelsCache = null;
  await ctx.editMessageText(
    `✅ *Anggota berhasil dihapus*\n` +
    `${member ? (member.username ? '@' + member.username : member.id) : removeId} sudah tidak punya akses lagi.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('admin_list', async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username)) return;
  const members = loadMembers();
  if (members.length === 0) {
    return ctx.editMessageText('📭 Belum ada anggota terdaftar.');
  }
  let msg = '📋 *Daftar Anggota:*\n\n';
  for (const m of members) {
    msg += `▸ ${m.username ? '@' + m.username : 'ID: ' + m.id}  \`[${m.id}]\`\n  Bergabung: ${new Date(m.addedAt).toLocaleDateString('id-ID')}\n`;
  }
  await ctx.editMessageText(msg, { parse_mode: 'Markdown' });
});

bot.action('admin_close', async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username)) return;
  await ctx.editMessageText('🔙 Panel Admin ditutup.');
});

bot.action('admin_panel', async (ctx) => {
  if (!isAdmin(ctx.from.id, ctx.from.username)) return;
  const members = loadMembers();
  await ctx.editMessageText(
    `👑 *Panel Admin SWDIO Bot*\n\nTotal anggota: *${members.length}* orang`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('➕ Tambah Anggota', 'admin_add')],
          [Markup.button.callback('➖ Hapus Anggota', 'admin_remove')],
          [Markup.button.callback('📋 Daftar Anggota', 'admin_list')],
          [Markup.button.callback('🔙 Tutup', 'admin_close')],
        ],
      },
    }
  );
});

const adminAction = new Map<number, 'add' | 'remove'>();

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const username = ctx.from.username;

  // Admin add member via text
  const action = adminAction.get(userId);
  if (action === 'add') {
    if (!isAdmin(userId, username)) return;
    adminAction.delete(userId);

    let targetId: number | null = null;
    let targetUsername: string | undefined;

    const clean = text.replace('@', '').trim();
    // Check if it's a numeric ID
    if (/^\d+$/.test(clean)) {
      targetId = parseInt(clean);
    } else {
      targetUsername = clean;
    }

    if (targetId === null && !targetUsername) {
      return ctx.reply('❌ Format tidak valid. Kirim username (tanpa @) atau ID numerik.');
    }

    const members = loadMembers();

    // If we have a username, try to resolve it via chat member lookup
    if (targetUsername && targetId === null) {
      try {
        const chatInfo: any = await ctx.telegram.getChat(`@${targetUsername}`);
        targetId = chatInfo.id;
        if (!targetUsername) targetUsername = chatInfo.username || undefined;
      } catch {
        // If can't resolve, check if already exists by username
        const existing = members.find(m => m.username?.toLowerCase() === targetUsername!.toLowerCase());
        if (existing) {
          return ctx.reply(`❌ @${targetUsername} sudah terdaftar (ID: ${existing.id}).`);
        }
        return ctx.reply(
          `❌ Tidak bisa mendapatkan info user @${targetUsername}.\n` +
          `Pastikan username benar, atau kirim ID numerik, atau minta user tersebut /start ke bot ini dulu.`
        );
      }
    }

    if (targetId === null) {
      return ctx.reply('❌ Gagal mendapatkan ID user. Coba kirim ID numerik saja.');
    }

    if (members.some(m => m.id === targetId)) {
      const existing = members.find(m => m.id === targetId);
      return ctx.reply(
        `❌ ${existing?.username ? '@' + existing.username : 'ID: ' + targetId} sudah terdaftar.`
      );
    }

    members.push({
      id: targetId,
      username: targetUsername,
      addedAt: new Date().toISOString(),
      addedBy: userId,
    });
    saveMembers(members);

    await ctx.reply(
      `✅ *Anggota berhasil ditambahkan\\!*\n` +
      `${targetUsername ? '@' + targetUsername : 'ID: ' + targetId} sekarang bisa menggunakan bot\\.`,
      { parse_mode: 'MarkdownV2' }
    );

    // Notify the new member
    try {
      await ctx.telegram.sendMessage(
        targetId,
        `🎉 *Selamat\\!*\n\nKamu telah ditambahkan sebagai anggota *SWDIO Bot* oleh admin\\.\nSekarang kamu bisa menggunakan bot ini untuk generate video dan image AI\\.\n\nKetik /start untuk memulai\\!`,
        { parse_mode: 'MarkdownV2' }
      );
    } catch {}

    return;
  }

  // Skip keyboard menu texts
  if (['✨ Buat Video', '🎨 Buat Image', '📋 Daftar Model', '👑 Panel Admin'].includes(text)) return;

  // Check auth for session
  if (!isAdmin(userId, username) && !isMember(userId)) return;

  const session = userSessions.get(userId);
  if (!session) return;

  if (session.step === 'prompt') {
    session.prompt = text;

    const allModels = await getModels();
    const list = session.category === 'video' ? allModels.video : allModels.image;
    const modelInfo = list.find(m => m.model === session.model);

    if (modelInfo?.needs_image || modelInfo?.supports_image) {
      session.step = 'image_url';
      await ctx.reply(
        '✅ Prompt diterima\\!\n\n📸 Sekarang *kirim foto* sebagai input\\, atau klik tombol "Skip" jika hanya pakai text\\.',
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('⏭ Skip (Text Only)', 'skip_image')],
            ],
          },
        }
      );
      return;
    }

    if (session.category === 'video') {
      session.step = 'duration';
      const durations = modelInfo?.durations;
      if (durations && durations.length > 0) {
        const buttons = durations.map(d => [Markup.button.callback(`${d} dtk`, `dur_${d}`)]);
        await ctx.reply('⏱ *Pilih durasi video:*', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons },
        });
      } else {
        session.duration = 5;
        session.step = 'resolution';
        await askResolution(ctx, session);
      }
    } else {
      session.step = 'aspect_ratio';
      await askAspectRatio(ctx, session);
    }
  }
});

bot.command('video', requireAuth, async (ctx) => showVideoModels(ctx));
bot.command('image', requireAuth, async (ctx) => showImageModels(ctx));
bot.command('models', requireAuth, async (ctx) => {
  await ctx.reply('📡 Mengambil daftar model...');
  try {
    const { video, image } = await getModels();
    let msg = '🎬 *Model Video:*\n';
    for (const m of video) {
      msg += `▸ *${m.label}* — \`${m.model}\`\n  ${m.description}\n\n`;
    }
    msg += '\n🎨 *Model Image:*\n';
    for (const m of image) {
      msg += `▸ *${m.label}* — \`${m.model}\`\n  ${m.description}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: 'Markdown', ...getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)) });
  } catch (e: any) {
    await ctx.reply(`❌ Gagal mengambil model: ${e.message}`);
  }
});

// ── User Sessions ──

const userSessions = new Map<number, {
  step: 'prompt' | 'image_url' | 'duration' | 'resolution' | 'aspect_ratio' | 'confirm';
  model: string;
  category: 'video' | 'image';
  prompt?: string;
  image_url?: string;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
}>();

bot.action(/^(video|image)_(.+)/, requireAuth, async (ctx) => {
  const [, category, model] = ctx.match;
  const userId = ctx.from.id;

  const allModels = await getModels();
  const list = category === 'video' ? allModels.video : allModels.image;
  const modelInfo = list.find(m => m.model === model);

  userSessions.set(userId, {
    step: 'prompt',
    model,
    category: category as 'video' | 'image',
  });

  let msg = `🤖 *Model:* ${modelInfo?.label || model}\n\n✍️ *Masukkan prompt / deskripsi:*\nTulis apa yang ingin kamu buat...`;
  if (modelInfo?.needs_image || modelInfo?.supports_image) {
    msg += '\n\n📸 *Tips:* Model ini bisa pake gambar\\! Nanti setelah prompt, kamu bisa kirim fotonya\\.';
  }
  await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2' });
});

bot.action('skip_image', requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session) return;

  await ctx.editMessageText('⏭ Tanpa gambar, lanjut ke langkah berikutnya...');

  if (session.category === 'video') {
    const allModels = await getModels();
    const list = allModels.video;
    const modelInfo = list.find(m => m.model === session.model);

    session.step = 'duration';
    const durations = modelInfo?.durations;
    if (durations && durations.length > 0) {
      const buttons = durations.map(d => [Markup.button.callback(`${d} dtk`, `dur_${d}`)]);
      await ctx.reply('⏱ *Pilih durasi video:*', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      session.duration = 5;
      session.step = 'resolution';
      await askResolution(ctx, session);
    }
  } else {
    session.step = 'aspect_ratio';
    await askAspectRatio(ctx, session);
  }
});

async function askResolution(ctx: any, session: any) {
  const allModels = await getModels();
  const list = session.category === 'video' ? allModels.video : allModels.image;
  const modelInfo = list.find(m => m.model === session.model);
  const resolutions = modelInfo?.resolutions;
  if (resolutions && resolutions.length > 0) {
    const buttons = resolutions.map(r => [Markup.button.callback(r, `res_${r}`)]);
    await ctx.reply('📺 *Pilih resolusi:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    session.resolution = '720p';
    session.step = 'aspect_ratio';
    await askAspectRatio(ctx, session);
  }
}

async function askAspectRatio(ctx: any, session: any) {
  const allModels = await getModels();
  const list = session.category === 'video' ? allModels.video : allModels.image;
  const modelInfo = list.find(m => m.model === session.model);
  const ratios = modelInfo?.aspect_ratios || ['16:9', '9:16', '1:1'];
  const buttons = ratios.map(r => [Markup.button.callback(r, `ar_${r}`)]);
  await ctx.reply('📐 *Pilih aspect ratio:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });
}

bot.action(/^dur_(\d+)/, requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session) return;
  session.duration = parseInt(ctx.match[1]);
  session.step = 'resolution';
  await ctx.editMessageText(`✅ Durasi: ${session.duration} detik`);
  await askResolution(ctx, session);
});

bot.action(/^res_(.+)/, requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session) return;
  session.resolution = ctx.match[1];
  session.step = 'aspect_ratio';
  await ctx.editMessageText(`✅ Resolusi: ${session.resolution}`);
  await askAspectRatio(ctx, session);
});

bot.action(/^ar_(.+)/, requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session) return;
  session.aspect_ratio = ctx.match[1];
  session.step = 'confirm';

  const allModels = await getModels();
  const list = session.category === 'video' ? allModels.video : allModels.image;
  const modelInfo = list.find(m => m.model === session.model);

  const items: string[] = [];
  items.push(`🤖 *Model:* ${modelInfo?.label || session.model}`);
  items.push(`✍️ *Prompt:* ${session.prompt}`);
  if (session.duration) items.push(`⏱ *Durasi:* ${session.duration}s`);
  if (session.resolution) items.push(`📺 *Resolusi:* ${session.resolution}`);
  items.push(`📐 *Ratio:* ${session.aspect_ratio}`);
  if (session.image_url) items.push(`📸 *Image:* ✅ Terlampir`);

  await ctx.editMessageText(
    `📋 *Konfirmasi Generate*\n\n${items.join('\n')}\n\nLanjutkan?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            Markup.button.callback('🚀 Lanjutkan', 'confirm_yes'),
            Markup.button.callback('❌ Batalkan', 'confirm_no'),
          ],
        ],
      },
    }
  );
});

bot.action('confirm_yes', requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session) return;

  await ctx.editMessageText('⏳ *Memproses...* Mohon tunggu sebentar.', { parse_mode: 'Markdown' });

  try {
    const result = await generateMedia({
      model: session.model,
      prompt: session.prompt || '',
      duration: session.duration,
      resolution: session.resolution,
      aspect_ratio: session.aspect_ratio,
      image_url: session.image_url,
    });

    if ('error' in result) {
      await ctx.reply(`❌ *Gagal:* ${result.error}`, { parse_mode: 'Markdown' });
      return;
    }

    if (result.url) {
      if (session.category === 'video') {
        await ctx.replyWithVideo(result.url, {
          caption: `✅ *Selesai!*\nModel: ${session.model}`,
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.replyWithPhoto(result.url, {
          caption: `✅ *Selesai!*\nModel: ${session.model}`,
          parse_mode: 'Markdown',
        });
      }
      await ctx.reply('Ada lagi?', getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)));
      return;
    }

    if (result.job_id) {
      await ctx.reply(
        `🔍 *Job terkirim!* ID: \`${result.job_id}\`\n⏳ Tunggu hasil...`,
        { parse_mode: 'Markdown' }
      );
      const resultUrl = await waitForResult(result.job_id);
      if (resultUrl) {
        if (session.category === 'video') {
          await ctx.replyWithVideo(resultUrl, {
            caption: `✅ *Selesai!*\nModel: ${session.model}`,
            parse_mode: 'Markdown',
          });
        } else {
          await ctx.replyWithPhoto(resultUrl, {
            caption: `✅ *Selesai!*\nModel: ${session.model}`,
            parse_mode: 'Markdown',
          });
        }
      } else {
        await ctx.reply('❌ *Gagal atau timeout.* Coba lagi nanti.', { parse_mode: 'Markdown' });
      }
      await ctx.reply('Ada lagi?', getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)));
    }
  } catch (e: any) {
    await ctx.reply(`❌ *Error:* ${e.message}`, { parse_mode: 'Markdown' });
  } finally {
    userSessions.delete(userId);
  }
});

bot.action('confirm_no', requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  userSessions.delete(userId);
  await ctx.editMessageText('❌ Dibatalkan.');
  await ctx.reply('Ada lagi?', getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)));
});

bot.action('back_menu', requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  userSessions.delete(userId);
  await ctx.editMessageText('🔙 Kembali ke menu utama.');
  await ctx.reply('Silakan pilih menu:', getMainKeyboard(isAdmin(ctx.from.id, ctx.from.username)));
});

bot.on(message('photo'), requireAuth, async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (!session || session.step !== 'image_url') return;

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  session.image_url = fileLink.href;

  await ctx.reply('📸 Foto diterima!');

  if (session.category === 'video') {
    const allModels = await getModels();
    const list = allModels.video;
    const modelInfo = list.find(m => m.model === session.model);

    session.step = 'duration';
    const durations = modelInfo?.durations;
    if (durations && durations.length > 0) {
      const buttons = durations.map((d: number) => [Markup.button.callback(`${d} dtk`, `dur_${d}`)]);
      await ctx.reply('⏱ *Pilih durasi video:*', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      session.duration = 5;
      session.step = 'resolution';
      await askResolution(ctx, session);
    }
  } else {
    session.step = 'aspect_ratio';
    await askAspectRatio(ctx, session);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().then(() => {
  console.log(`Bot @swdio_bot running...`);
});
