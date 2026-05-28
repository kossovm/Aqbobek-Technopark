-- ============================================================================
-- 03_auth_fixes.sql
--
-- Задача миграции:
--   1) Сделать регистрацию устойчивой без зависимости от service_role на сервере:
--      когда Supabase Auth создаёт строку в auth.users, триггер handle_new_user
--      автоматически создаёт строку в public.users (full_name берётся из
--      user_metadata, переданного при signUp).
--   2) Привести RLS-политики таблицы public.users в рабочий вид:
--      - Пользователь может видеть и обновлять только свою строку.
--      - Staff (admin/teacher) видит и обновляет всех, admin может удалять.
--   3) Хранить email в public.users (зеркало auth.users), чтобы админка могла
--      его показывать без обращения к auth.* (service_role).
--   4) Добавить поле has_acknowledged_rules для hard-блока онбординга.
--   5) Добавить helper-функцию is_admin().
--
-- Запускайте этот файл в SQL Editor Supabase ОДИН раз, после 02_user_approval.sql.
-- ============================================================================

-- ---------- 1. Доп. колонки в public.users ----------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS has_acknowledged_rules BOOLEAN DEFAULT false NOT NULL;

-- Backfill email-ов из auth.users (один раз)
UPDATE public.users u
SET email = au.email
FROM auth.users au
WHERE u.id = au.id AND (u.email IS NULL OR u.email = '');


-- ---------- 2. Helper: is_admin() -------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin' AND is_approved = true
  );
$$ LANGUAGE sql SECURITY DEFINER;


-- ---------- 3. Trigger: автосоздание profile при регистрации ----------------
-- Берёт full_name из raw_user_meta_data, role = 'student' по умолчанию,
-- is_approved = false (ждёт подтверждения админом).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, full_name, email, role, is_approved, has_acknowledged_rules)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    'student',
    false,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------- 4. RLS-политики public.users ------------------------------------
-- Снести старые, чтобы заменить чистым набором.
DROP POLICY IF EXISTS "Users are viewable by everyone" ON public.users;
DROP POLICY IF EXISTS "Users viewable by self or staff" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Users updatable by self or staff" ON public.users;
DROP POLICY IF EXISTS "Users deletable by admin" ON public.users;

-- SELECT: видит сам себя; staff видит всех
CREATE POLICY "users_select_self_or_staff" ON public.users
  FOR SELECT USING (auth.uid() = id OR public.is_staff());

-- INSERT: разрешаем только вставку собственной строки. Триггер всё равно делает это
--         через SECURITY DEFINER, но политика нужна, если когда-то будем вставлять
--         напрямую из клиента/Server Action со своей сессией.
CREATE POLICY "users_insert_self" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- UPDATE: сам может обновлять свою строку (но НЕ role и НЕ is_approved — это
-- enforced в API/Server Actions); staff может обновлять любого.
CREATE POLICY "users_update_self_or_staff" ON public.users
  FOR UPDATE USING (auth.uid() = id OR public.is_staff());

-- DELETE: только admin
CREATE POLICY "users_delete_admin" ON public.users
  FOR DELETE USING (public.is_admin());


-- ---------- 5. Защитный триггер: запрет менять свою роль/approve ------------
-- Чтобы юзер не смог через прямой UPDATE поднять себя до admin.
CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- Если апдейт от лица staff — пропускаем.
  IF public.is_staff() THEN
    RETURN NEW;
  END IF;

  -- Иначе любому юзеру запрещено трогать чувствительные поля.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Изменение роли разрешено только staff';
  END IF;
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    RAISE EXCEPTION 'Изменение статуса подтверждения разрешено только staff';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS users_prevent_priv_esc ON public.users;
CREATE TRIGGER users_prevent_priv_esc
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_privilege_escalation();


-- ---------- 6. Удобный VIEW для админки (с email) ---------------------------
-- Можно селектить из public.users напрямую — email теперь там есть.
-- Оставлено как заметка: ничего дополнительно не создаём.

-- ---------- 7. Опционально: первый admin --------------------------------------
-- Раскомментируйте и подставьте email, чтобы автоматически выдать первому
-- пользователю роль admin (полезно при первом запуске):
--
-- UPDATE public.users SET role = 'admin', is_approved = true, has_acknowledged_rules = true
-- WHERE email = 'your@email.kz';
