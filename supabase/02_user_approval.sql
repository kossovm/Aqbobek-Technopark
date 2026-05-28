-- 1. Добавляем колонку is_approved в таблицу users, по умолчанию false
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false NOT NULL;

-- 2. Делаем всех текущих пользователей подтвержденными (обратная совместимость)
UPDATE public.users SET is_approved = true WHERE is_approved = false;

-- 3. Создаем вспомогательную функцию для проверки подтверждения
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS BOOLEAN AS $$
  SELECT is_approved FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 4. Обновляем функцию is_staff, чтобы она тоже требовала подтверждения
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin', 'teacher') AND is_approved = true
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 5. Заменяем политики для public.users (чтобы юзеры могли видеть только себя и staff видел всех)
DROP POLICY IF EXISTS "Users are viewable by everyone" ON public.users;
CREATE POLICY "Users viewable by self or staff" ON public.users FOR SELECT USING (auth.uid() = id OR public.is_staff());

-- 6. Ограничиваем просмотр других таблиц только подтвержденными пользователями
-- Инвентарь
DROP POLICY IF EXISTS "Inventory viewable by everyone" ON public.inventory;
CREATE POLICY "Inventory viewable by approved users" ON public.inventory FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

-- Локации
DROP POLICY IF EXISTS "Locations viewable by everyone" ON public.locations;
CREATE POLICY "Locations viewable by approved users" ON public.locations FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

-- Расходники
DROP POLICY IF EXISTS "Consumables viewable by everyone" ON public.consumables;
CREATE POLICY "Consumables viewable by approved users" ON public.consumables FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

-- Проекты
DROP POLICY IF EXISTS "Projects viewable by everyone" ON public.projects;
CREATE POLICY "Projects viewable by approved users" ON public.projects FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

-- Участники проектов
DROP POLICY IF EXISTS "Project members viewable by everyone" ON public.project_members;
CREATE POLICY "Project members viewable by approved users" ON public.project_members FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

-- Инвентарь проектов
DROP POLICY IF EXISTS "Project inventory viewable by everyone" ON public.project_inventory;
CREATE POLICY "Project inventory viewable by approved users" ON public.project_inventory FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());
