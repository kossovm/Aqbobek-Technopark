-- ============================================================================
-- 08_inventory_overhaul.sql
--
-- Большой overhaul инвентаря и проектов:
--   1. Таблица categories — справочник категорий со свойствами
--      (is_consumable, default_unit и описание).
--   2. inventory расширяется: category_id, description, quantity (сколько штук
--      всего), quantity_available (сколько свободно сейчас), unit, is_consumable,
--      label_printed.
--   3. transactions: quantity (сколько штук взято) и project_id.
--   4. projects: description (уже есть), box_location_id (где лежит коробка).
--   5. consumable_usage: description (что и для чего).
--   6. activity_logs — общий журнал действий (вход/выход/чек-аут/возврат).
--   7. RPC adjust_inventory_quantity — атомарное изменение остатка.
--
-- Запускать ОДИН раз в SQL Editor Supabase после 07_fix_priv_trigger.sql.
-- ============================================================================

-- ---------- 1. Categories ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  is_consumable BOOLEAN DEFAULT false NOT NULL,
  default_unit  TEXT DEFAULT 'piece' NOT NULL
                CHECK (default_unit IN ('piece','kg','m2','liter','meter','gram','cm2')),
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_all" ON public.categories;
CREATE POLICY "categories_select_all" ON public.categories
  FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

DROP POLICY IF EXISTS "categories_modify_staff" ON public.categories;
CREATE POLICY "categories_modify_staff" ON public.categories
  FOR ALL USING (public.is_staff());

-- Сидируем дефолтные категории
INSERT INTO public.categories (name, is_consumable, default_unit, description) VALUES
  ('Электроника',  false, 'piece', 'Платы, паяльники, осциллографы и пр.'),
  ('Инструменты',  false, 'piece', 'Отвёртки, плоскогубцы, ключи (в одном экземпляре)'),
  ('Датчики',      true,  'piece', 'Расходные датчики и компоненты для сборки'),
  ('Расходники',   true,  'piece', 'Мелкие штучные расходники'),
  ('Пластик 3D',   true,  'gram',  'Филамент для 3D-принтеров'),
  ('Фанера',       true,  'm2',    'Листы для лазерной резки')
ON CONFLICT (name) DO NOTHING;


-- ---------- 2. Расширение inventory -----------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS category_id        UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS quantity           NUMERIC(10,2) DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS quantity_available NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS unit               TEXT DEFAULT 'piece' NOT NULL,
  ADD COLUMN IF NOT EXISTS is_consumable      BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS label_printed      BOOLEAN DEFAULT false NOT NULL;

-- Бэкфилл quantity_available из quantity
UPDATE public.inventory
SET quantity_available = quantity
WHERE quantity_available IS NULL;

-- Бэкфилл category_id из старой колонки category (по совпадению имени)
UPDATE public.inventory inv
SET category_id = c.id
FROM public.categories c
WHERE inv.category = c.name AND inv.category_id IS NULL;


-- ---------- 3. Transactions: количество и проект ----------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS quantity   NUMERIC(10,2) DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_inventory_open
  ON public.transactions (inventory_id) WHERE returned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_open
  ON public.transactions (user_id) WHERE returned_at IS NULL;


-- ---------- 4. Projects: коробка проекта ------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS box_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;


-- ---------- 5. Consumable usage: описание -----------------------------------
ALTER TABLE public.consumable_usage
  ADD COLUMN IF NOT EXISTS description TEXT;


-- ---------- 6. Activity logs ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,         -- 'login','logout','checkout','return','consumable_use','scan_unknown','category_create' и т.д.
  entity_type TEXT,                  -- 'inventory','consumable','user','project','session','category'
  entity_id   UUID,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_select_staff" ON public.activity_logs;
CREATE POLICY "logs_select_staff" ON public.activity_logs
  FOR SELECT USING (public.is_staff());

-- Юзер может писать про себя; service_role обходит RLS
DROP POLICY IF EXISTS "logs_insert_self" ON public.activity_logs;
CREATE POLICY "logs_insert_self" ON public.activity_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user    ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity  ON public.activity_logs(entity_type, entity_id);


-- ---------- 7. RPC: атомарное изменение остатка ------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_inventory_id UUID,
  p_delta        NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
  v_new NUMERIC;
BEGIN
  UPDATE public.inventory
  SET quantity_available = COALESCE(quantity_available, quantity) + p_delta,
      updated_at = NOW()
  WHERE id = p_inventory_id
  RETURNING quantity_available INTO v_new;
  RETURN v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.adjust_inventory_quantity(UUID, NUMERIC) TO authenticated;
