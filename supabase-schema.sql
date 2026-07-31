-- Виконай цей SQL у Supabase → SQL Editor → New Query

CREATE TABLE products (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  brand       TEXT,
  price       INTEGER NOT NULL,
  old_price   INTEGER,
  size        TEXT,
  type        TEXT CHECK (type IN ('new', 'used', 'stock')) DEFAULT 'stock',
  category    TEXT DEFAULT 'other',
  img         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Дозволяємо читання всім (для сайту)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Читання для всіх"
  ON products FOR SELECT
  USING (true);

CREATE POLICY "Запис тільки з сервісним ключем"
  ON products FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Видалення тільки з сервісним ключем"
  ON products FOR DELETE
  USING (true);
