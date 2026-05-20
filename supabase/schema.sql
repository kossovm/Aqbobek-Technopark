-- Установка расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Создание кастомных типов ENUM
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE inventory_status AS ENUM ('available', 'in_use', 'maintenance', 'lost');
CREATE TYPE project_status AS ENUM ('planning', 'active', 'completed', 'archived');
CREATE TYPE consumable_unit AS ENUM ('gram', 'cm2', 'piece');

-- 1. Таблица профилей пользователей (расширяет auth.users)
CREATE TABLE public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  role user_role DEFAULT 'student'::user_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Локации (шкафы, полки)
CREATE TABLE public.locations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Инвентарь (оборудование)
CREATE TABLE public.inventory (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  status inventory_status DEFAULT 'available'::inventory_status NOT NULL,
  qr_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Транзакции (выдача/возврат оборудования)
CREATE TABLE public.transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE CASCADE NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  returned_at TIMESTAMPTZ,
  notes TEXT
);

-- 5. Расходники
CREATE TABLE public.consumables (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL, -- например, 'Пластик Anycubic PLA'
  material_type TEXT NOT NULL, -- например, 'PLA', 'Фанера', 'ПВХ'
  unit consumable_unit NOT NULL,
  quantity_in_stock DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. Проекты
CREATE TABLE public.projects (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status project_status DEFAULT 'planning'::project_status NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 7. Участники проектов (Множественные связи пользователей и проектов)
CREATE TABLE public.project_members (
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- 8. Инвентарь, закрепленный за проектом
CREATE TABLE public.project_inventory (
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  inventory_id UUID REFERENCES public.inventory(id) ON DELETE CASCADE NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (project_id, inventory_id)
);


-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) ПОЛИТИКИ
-- ==============================================================================

-- Включаем RLS для всех таблиц
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_inventory ENABLE ROW LEVEL SECURITY;

-- Вспомогательная функция для проверки прав админа или учителя
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin', 'teacher')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ПОЛИТИКИ ДЛЯ USERS
-- Читать могут все авторизованные. Изменять - только сам пользователь или staff.
CREATE POLICY "Users are viewable by everyone" ON public.users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- ПОЛИТИКИ ДЛЯ INVENTORY & LOCATIONS
-- Видят все. Изменяют только staff.
CREATE POLICY "Inventory viewable by everyone" ON public.inventory FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Inventory insertable by staff" ON public.inventory FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "Inventory updatable by staff" ON public.inventory FOR UPDATE USING (public.is_staff());

CREATE POLICY "Locations viewable by everyone" ON public.locations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Locations modifiable by staff" ON public.locations FOR ALL USING (public.is_staff());

-- ПОЛИТИКИ ДЛЯ TRANSACTIONS
-- Все могут видеть свои транзакции. Staff может видеть и создавать любые.
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id OR public.is_staff());
CREATE POLICY "Staff can insert transactions" ON public.transactions FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "Staff can update transactions" ON public.transactions FOR UPDATE USING (public.is_staff());

-- ПОЛИТИКИ ДЛЯ CONSUMABLES
CREATE POLICY "Consumables viewable by everyone" ON public.consumables FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Consumables modifiable by staff" ON public.consumables FOR ALL USING (public.is_staff());

-- ПОЛИТИКИ ДЛЯ PROJECTS
-- Все могут видеть проекты.
CREATE POLICY "Projects viewable by everyone" ON public.projects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Projects modifiable by staff" ON public.projects FOR ALL USING (public.is_staff());

-- ПОЛИТИКИ ДЛЯ PROJECT_MEMBERS & PROJECT_INVENTORY
CREATE POLICY "Project members viewable by everyone" ON public.project_members FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Project members modifiable by staff" ON public.project_members FOR ALL USING (public.is_staff());

CREATE POLICY "Project inventory viewable by everyone" ON public.project_inventory FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Project inventory modifiable by staff" ON public.project_inventory FOR ALL USING (public.is_staff());
