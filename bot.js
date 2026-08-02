const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const http = require('http');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);

const sessions = {};

function isAdmin(id) {
  return id === ADMIN_ID;
}

// ─── ГОЛОВНЕ МЕНЮ ───
function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['➕ Додати товар'],
        ['📦 Мої товари', '🗑 Видалити товар'],
        ['📊 Статистика'],
      ],
      resize_keyboard: true,
    },
  };
}

function cancelKeyboard() {
  return {
    reply_markup: {
      keyboard: [['❌ Скасувати']],
      resize_keyboard: true,
    },
  };
}

// ─── /start ───
bot.onText(/\/start/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Доступ заборонено.');
  bot.sendMessage(msg.chat.id, `👋 Привіт! Це адмін-бот *KADORA*.\n\nОбери дію:`, {
    parse_mode: 'Markdown', ...mainMenu()
  });
});

// ─── ПОВІДОМЛЕННЯ ───
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!isAdmin(msg.from.id)) return;

  if (text === '❌ Скасувати') {
    delete sessions[chatId];
    return bot.sendMessage(chatId, '↩️ Скасовано.', mainMenu());
  }

  const session = sessions[chatId];

  // ─── ДОДАТИ ТОВАР ───
  if (text === '➕ Додати товар') {
    sessions[chatId] = { step: 'photo' };
    return bot.sendMessage(chatId, '📸 Надішли *фото товару*:', { parse_mode: 'Markdown', ...cancelKeyboard() });
  }

  // ─── МОЇ ТОВАРИ ───
  if (text === '📦 Мої товари') {
    const { data } = await supabase.from('products').select('id, title, price, type').order('created_at', { ascending: false }).limit(10);
    if (!data || !data.length) return bot.sendMessage(chatId, '📭 Товарів поки немає.', mainMenu());
    const list = data.map((p, i) => `${i+1}. *${p.title}* — ${p.price} грн [${p.type}]`).join('\n');
    return bot.sendMessage(chatId, `📦 *Останні 10 товарів:*\n\n${list}`, { parse_mode: 'Markdown', ...mainMenu() });
  }

  // ─── ВИДАЛИТИ ТОВАР ───
  if (text === '🗑 Видалити товар') {
    const { data } = await supabase.from('products').select('id, title').order('created_at', { ascending: false }).limit(20);
    if (!data || !data.length) return bot.sendMessage(chatId, '📭 Немає товарів для видалення.', mainMenu());
    const buttons = data.map((p) => [{ text: `🗑 ${p.title}`, callback_data: `delete_${p.id}` }]);
    return bot.sendMessage(chatId, '⬇️ Оберіть товар для видалення:', { reply_markup: { inline_keyboard: buttons } });
  }

  // ─── СТАТИСТИКА ───
  if (text === '📊 Статистика') {
    const { count: total }     = await supabase.from('products').select('*', { count: 'exact', head: true });
    const { count: newCount }  = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('type', 'new');
    const { count: usedCount } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('type', 'used');
    const { count: stockCount }= await supabase.from('products').select('*', { count: 'exact', head: true }).eq('type', 'stock');
    return bot.sendMessage(chatId,
      `📊 *Статистика KADORA:*\n\n🛍 Всього: *${total}*\n🆕 Новий: *${newCount}*\n♻️ Вживаний: *${usedCount}*\n🏷 Сток: *${stockCount}*`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  }

  if (!session) return;

  // ─── КРОКИ ДОДАВАННЯ ТОВАРУ ───
  if (session.step === 'photo') {
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendMessage(chatId, '⏳ Завантажую фото...');
      try {
        const permanentUrl = await uploadPhotoToSupabase(fileId);
        if (!sessions[chatId].photos) sessions[chatId].photos = [];
        sessions[chatId].photos.push(permanentUrl);
        const count = sessions[chatId].photos.length;
        if (count < 5) {
          return bot.sendMessage(chatId,
            `✅ Фото ${count} збережено!\n\nНадішли ще фото або натисни "➡️ Далі" (максимум 5)`,
            {
              reply_markup: {
                keyboard: [['➡️ Далі'], ['❌ Скасувати']],
                resize_keyboard: true,
              }
            }
          );
        } else {
          sessions[chatId].step = 'title';
          return bot.sendMessage(chatId, '✅ Всі 5 фото збережено!\n\n📝 Введи *назву товару*:', { parse_mode: 'Markdown', ...cancelKeyboard() });
        }
      } catch (e) {
        console.error(e);
        return bot.sendMessage(chatId, '❌ Помилка завантаження фото. Спробуй ще раз.', cancelKeyboard());
      }
    }

    if (text === '➡️ Далі') {
      if (!sessions[chatId].photos || !sessions[chatId].photos.length) {
        return bot.sendMessage(chatId, '❗ Спочатку надішли хоча б одне фото.');
      }
      sessions[chatId].step = 'title';
      return bot.sendMessage(chatId, `✅ ${sessions[chatId].photos.length} фото збережено!\n\n📝 Введи *назву товару*:`, { parse_mode: 'Markdown', ...cancelKeyboard() });
    }

    return bot.sendMessage(chatId, '❗ Надішли *фото* товару (до 5 штук):', { parse_mode: 'Markdown' });
  }

  if (session.step === 'title' && text) {
    sessions[chatId].title = text;
    sessions[chatId].step = 'brand';
    return bot.sendMessage(chatId, '👗 Введи *бренд* (напр. Zara, H&M):', { parse_mode: 'Markdown', ...cancelKeyboard() });
  }

  if (session.step === 'brand' && text) {
    sessions[chatId].brand = text;
    sessions[chatId].step = 'price';
    return bot.sendMessage(chatId, '💰 Введи *ціну* (тільки число, грн):', { parse_mode: 'Markdown', ...cancelKeyboard() });
  }

  if (session.step === 'price' && text) {
    const price = parseInt(text);
    if (isNaN(price)) return bot.sendMessage(chatId, '❗ Введи число, наприклад: *750*', { parse_mode: 'Markdown' });
    sessions[chatId].price = price;
    sessions[chatId].step = 'oldPrice';
    return bot.sendMessage(chatId, '🏷 Стара ціна (для знижки) або напиши *пропустити*:', {
      parse_mode: 'Markdown',
      reply_markup: { keyboard: [['пропустити'], ['❌ Скасувати']], resize_keyboard: true }
    });
  }

  if (session.step === 'oldPrice' && text) {
    if (text.toLowerCase() !== 'пропустити') {
      const old = parseInt(text);
      if (!isNaN(old)) sessions[chatId].oldPrice = old;
    }
    sessions[chatId].step = 'size';
    return bot.sendMessage(chatId, '📏 Введи *розмір* (напр. M, L/XL, 38):', { parse_mode: 'Markdown', ...cancelKeyboard() });
  }

  if (session.step === 'size' && text) {
    sessions[chatId].size = text;
    sessions[chatId].step = 'type';
    return bot.sendMessage(chatId, '🏷 Тип товару:', {
      reply_markup: { keyboard: [['🆕 Новий', '♻️ Вживаний', '🏷 Сток'], ['❌ Скасувати']], resize_keyboard: true }
    });
  }

  if (session.step === 'type' && text) {
    const typeMap = { '🆕 Новий': 'new', '♻️ Вживаний': 'used', '🏷 Сток': 'stock' };
    const type = typeMap[text];
    if (!type) return bot.sendMessage(chatId, '❗ Оберіть один із варіантів.');
    sessions[chatId].type = type;
    sessions[chatId].step = 'category';
    return bot.sendMessage(chatId, '📂 Категорія:', {
      reply_markup: {
        keyboard: [
          ['👗 Сукні', '👚 Топи і блузи'],
          ['👖 Джинси', '🧥 Верхній одяг'],
          ["🧶 В'язаний", '👜 Аксесуари'],
          ['❌ Скасувати'],
        ],
        resize_keyboard: true,
      },
    });
  }

  if (session.step === 'category' && text) {
    const catMap = {
      '👗 Сукні': 'dresses', '👚 Топи і блузи': 'tops',
      '👖 Джинси': 'jeans', '🧥 Верхній одяг': 'outerwear',
      "🧶 В'язаний": 'knitwear', '👜 Аксесуари': 'accessories',
    };
    const category = catMap[text] || 'other';
    sessions[chatId].category = category;
    sessions[chatId].step = 'gender';
    return bot.sendMessage(chatId, '👤 Для кого товар?', {
      reply_markup: {
        keyboard: [['👩 Жіночий', '👨 Чоловічий', '👕 Унісекс'], ['❌ Скасувати']],
        resize_keyboard: true,
      },
    });
  }

  if (session.step === 'gender' && text) {
    const genderMap = { '👩 Жіночий': 'women', '👨 Чоловічий': 'men', '👕 Унісекс': 'unisex' };
    const gender = genderMap[text];
    if (!gender) return bot.sendMessage(chatId, '❗ Оберіть один із варіантів.');
    sessions[chatId].gender = gender;
    const s = sessions[chatId];
    await bot.sendMessage(chatId, '⏳ Зберігаю товар...');

    const { error } = await supabase.from('products').insert([{
      title: s.title, brand: s.brand, price: s.price,
      old_price: s.oldPrice || null, size: s.size,
      type: s.type, category: s.category, gender: s.gender,
      img: s.photos[0],
      images: s.photos,
    }]);

    delete sessions[chatId];

    if (error) {
      console.error(error);
      return bot.sendMessage(chatId, '❌ Помилка збереження.', mainMenu());
    }

    return bot.sendMessage(chatId,
      `✅ *Товар додано!*\n\n📦 ${s.title}\n👗 ${s.brand} · ${s.size}\n💰 ${s.price} грн\n👤 ${text}`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  }
});

// ─── CALLBACK: ВИДАЛЕННЯ (з меню і з замовлень) ───
bot.on('callback_query', async (query) => {
  if (!isAdmin(query.from.id)) return;
  const data = query.data;

  if (data.startsWith('delete_')) {
    const id = data.replace('delete_', '');
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return bot.answerCallbackQuery(query.id, { text: '❌ Помилка видалення' });
    bot.answerCallbackQuery(query.id, { text: '✅ Товар видалено з сайту!' });
    bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: '✅ Видалено з сайту', callback_data: 'done' }]] },
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    );
  }
});

// ─── HTTP СЕРВЕР ДЛЯ ЗАМОВЛЕНЬ З САЙТУ ───
// Сайт надсилає POST /order → бот відправляє повідомлення з кнопками видалення
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // CORS для сайту
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const order = JSON.parse(body);
        // order = { name, phone, address, items: [{id, brand, title, size, qty, price}], total }

        const itemsList = order.items
          .map(x => `  • ${x.brand} ${x.title} (${x.size}) × ${x.qty} — ${(x.price * x.qty).toLocaleString('uk-UA')} грн`)
          .join('\n');

        const message =
          `🛍 *НОВЕ ЗАМОВЛЕННЯ — KADORA*\n\n` +
          `👤 Імʼя: ${order.name}\n` +
          `📞 Телефон: ${order.phone}\n` +
          `📦 Адреса: ${order.address}\n\n` +
          `🧾 *Товари:*\n${itemsList}\n\n` +
          `💰 *Разом: ${order.total.toLocaleString('uk-UA')} грн*`;

        // Кнопки видалення для кожного товару
        const buttons = order.items.map(x => ([{
          text: `🗑 Видалити "${x.title}"`,
          callback_data: `delete_${x.id}`
        }]));

        await bot.sendMessage(ADMIN_ID, message, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error(e);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`🤖 KADORA Bot запущено. HTTP сервер на порту ${PORT}`);
});

// ─── ЗАВАНТАЖЕННЯ ФОТО В SUPABASE STORAGE ───
async function uploadPhotoToSupabase(fileId) {
  // 1. Отримуємо тимчасовий URL від Telegram
  const infoRes = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  const infoJson = await infoRes.json();
  const tgUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${infoJson.result.file_path}`;

  // 2. Завантажуємо фото як буфер
  const imgRes = await fetch(tgUrl);
  const buffer = await imgRes.buffer();

  // 3. Унікальне ім'я файлу
  const fileName = `product_${Date.now()}.jpg`;

  // 4. Завантажуємо в Supabase Storage (bucket "products")
  const { error } = await supabase.storage
    .from('products')
    .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: false });

  if (error) throw error;

  // 5. Повертаємо публічний URL (постійний!)
  const { data } = supabase.storage.from('products').getPublicUrl(fileName);
  return data.publicUrl;
}
