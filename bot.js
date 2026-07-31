const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const FormData = require('form-data');

const bot = new TelegramBot('8776687351:AAFLkLmYaI491F2XjTv6BPB2YDRovYZnVhE', { polling: true });
const supabase = createClient(
  'https://bhqampawhwhztfvkugrt.supabase.co',
  'YOUR_SUPABASE_SERVICE_ROLE_KEY'
);

const ADMIN_ID = NazarNikolaichuk;

// Стан сесій для кожного користувача
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
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '⛔ Доступ заборонено.');
  }
  bot.sendMessage(
    msg.chat.id,
    `👋 Привіт! Це адмін-бот магазину *KADORA*.\n\nОбери дію:`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

// ─── ГОЛОВНІ КОМАНДИ ───
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!isAdmin(msg.from.id)) return;

  // Скасувати будь-яку сесію
  if (text === '❌ Скасувати') {
    delete sessions[chatId];
    return bot.sendMessage(chatId, '↩️ Скасовано.', mainMenu());
  }

  const session = sessions[chatId];

  // ─── ДОДАТИ ТОВАР ───
  if (text === '➕ Додати товар') {
    sessions[chatId] = { step: 'photo' };
    return bot.sendMessage(
      chatId,
      '📸 Надішли *фото товару* (можна кілька — перше буде головним):',
      { parse_mode: 'Markdown', ...cancelKeyboard() }
    );
  }

  // ─── МОЇ ТОВАРИ ───
  if (text === '📦 Мої товари') {
    const { data, error } = await supabase
      .from('products')
      .select('id, title, price, type')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data.length) {
      return bot.sendMessage(chatId, '📭 Товарів поки немає.', mainMenu());
    }

    const list = data
      .map((p, i) => `${i + 1}. *${p.title}* — ${p.price} грн [${p.type}]`)
      .join('\n');

    return bot.sendMessage(chatId, `📦 *Останні 10 товарів:*\n\n${list}`, {
      parse_mode: 'Markdown',
      ...mainMenu(),
    });
  }

  // ─── ВИДАЛИТИ ТОВАР ───
  if (text === '🗑 Видалити товар') {
    const { data } = await supabase
      .from('products')
      .select('id, title')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!data || !data.length) {
      return bot.sendMessage(chatId, '📭 Немає товарів для видалення.', mainMenu());
    }

    const buttons = data.map((p) => [
      { text: `🗑 ${p.title}`, callback_data: `delete_${p.id}` },
    ]);

    return bot.sendMessage(chatId, '⬇️ Оберіть товар для видалення:', {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // ─── СТАТИСТИКА ───
  if (text === '📊 Статистика') {
    const { count: total } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { count: newCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'new');

    const { count: usedCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'used');

    const { count: stockCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'stock');

    return bot.sendMessage(
      chatId,
      `📊 *Статистика магазину KADORA:*\n\n` +
        `🛍 Всього товарів: *${total}*\n` +
        `🆕 Новий: *${newCount}*\n` +
        `♻️ Вживаний: *${usedCount}*\n` +
        `🏷 Сток: *${stockCount}*`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  }

  // ─── СЕСІЯ ДОДАВАННЯ ТОВАРУ ───
  if (!session) return;

  // Крок 1: Фото
  if (session.step === 'photo') {
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const fileUrl = await getFileUrl(fileId);
      sessions[chatId].photoUrl = fileUrl;
      sessions[chatId].step = 'title';
      return bot.sendMessage(chatId, '✅ Фото отримано!\n\n📝 Тепер введи *назву товару*:', {
        parse_mode: 'Markdown',
        ...cancelKeyboard(),
      });
    } else {
      return bot.sendMessage(chatId, '❗ Надішли саме *фото*, не файл.', {
        parse_mode: 'Markdown',
      });
    }
  }

  // Крок 2: Назва
  if (session.step === 'title' && text) {
    sessions[chatId].title = text;
    sessions[chatId].step = 'brand';
    return bot.sendMessage(chatId, '👗 Введи *бренд* (напр. Zara, H&M, Mango):', {
      parse_mode: 'Markdown',
      ...cancelKeyboard(),
    });
  }

  // Крок 3: Бренд
  if (session.step === 'brand' && text) {
    sessions[chatId].brand = text;
    sessions[chatId].step = 'price';
    return bot.sendMessage(chatId, '💰 Введи *ціну* (тільки число, грн):', {
      parse_mode: 'Markdown',
      ...cancelKeyboard(),
    });
  }

  // Крок 4: Ціна
  if (session.step === 'price' && text) {
    const price = parseInt(text);
    if (isNaN(price)) {
      return bot.sendMessage(chatId, '❗ Введи число, наприклад: *750*', { parse_mode: 'Markdown' });
    }
    sessions[chatId].price = price;
    sessions[chatId].step = 'oldPrice';
    return bot.sendMessage(
      chatId,
      '🏷 Стара ціна (необов\'язково, для показу знижки).\nВведи число або напиши *пропустити*:',
      { parse_mode: 'Markdown', reply_markup: { keyboard: [['пропустити'], ['❌ Скасувати']], resize_keyboard: true } }
    );
  }

  // Крок 5: Стара ціна
  if (session.step === 'oldPrice' && text) {
    if (text.toLowerCase() !== 'пропустити') {
      const old = parseInt(text);
      if (!isNaN(old)) sessions[chatId].oldPrice = old;
    }
    sessions[chatId].step = 'size';
    return bot.sendMessage(chatId, '📏 Введи *розмір* (напр. M, L/XL, 38):', {
      parse_mode: 'Markdown',
      ...cancelKeyboard(),
    });
  }

  // Крок 6: Розмір
  if (session.step === 'size' && text) {
    sessions[chatId].size = text;
    sessions[chatId].step = 'type';
    return bot.sendMessage(chatId, '🏷 Тип товару:', {
      reply_markup: {
        keyboard: [['🆕 Новий', '♻️ Вживаний', '🏷 Сток'], ['❌ Скасувати']],
        resize_keyboard: true,
      },
    });
  }

  // Крок 7: Тип
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
          ['🧶 В\'язаний', '👜 Аксесуари'],
          ['❌ Скасувати'],
        ],
        resize_keyboard: true,
      },
    });
  }

  // Крок 8: Категорія → збереження
  if (session.step === 'category' && text) {
    const catMap = {
      '👗 Сукні': 'dresses',
      '👚 Топи і блузи': 'tops',
      '👖 Джинси': 'jeans',
      '🧥 Верхній одяг': 'outerwear',
      "🧶 В'язаний": 'knitwear',
      '👜 Аксесуари': 'accessories',
    };
    const category = catMap[text] || 'other';
    const s = sessions[chatId];

    await bot.sendMessage(chatId, '⏳ Зберігаю товар...', cancelKeyboard());

    const product = {
      title: s.title,
      brand: s.brand,
      price: s.price,
      old_price: s.oldPrice || null,
      size: s.size,
      type: s.type,
      category,
      img: s.photoUrl,
    };

    const { error } = await supabase.from('products').insert([product]);

    delete sessions[chatId];

    if (error) {
      console.error(error);
      return bot.sendMessage(chatId, '❌ Помилка збереження. Перевір налаштування Supabase.', mainMenu());
    }

    return bot.sendMessage(
      chatId,
      `✅ *Товар успішно додано!*\n\n` +
        `📦 ${s.title}\n` +
        `👗 ${s.brand} · ${s.size}\n` +
        `💰 ${s.price} грн${s.oldPrice ? ` (було ${s.oldPrice} грн)` : ''}\n` +
        `🏷 Тип: ${s.type} | Категорія: ${category}`,
      { parse_mode: 'Markdown', ...mainMenu() }
    );
  }
});

// ─── CALLBACK: ВИДАЛЕННЯ ───
bot.on('callback_query', async (query) => {
  if (!isAdmin(query.from.id)) return;

  const data = query.data;
  if (data.startsWith('delete_')) {
    const id = data.replace('delete_', '');
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      return bot.answerCallbackQuery(query.id, { text: '❌ Помилка видалення' });
    }
    bot.answerCallbackQuery(query.id, { text: '✅ Товар видалено!' });
    bot.editMessageText('🗑 Товар видалено.', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    });
  }
});

// ─── ОТРИМАТИ URL ФОТО ───
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const json = await res.json();
  const path = json.result.file_path;
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${path}`;
}

console.log('🤖 KADORA Bot запущено...');
