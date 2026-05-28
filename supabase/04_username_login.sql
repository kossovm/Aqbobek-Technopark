-- ============================================================================
-- 04_username_login.sql
--
-- Переход с email-логина на username-логин. Email становится опциональным.
--
-- Идея:
--   Supabase Auth работает только с email/phone. Мы используем фейковый домен
--   `@aqbobek.kz` для синтетического email, чтобы юзер мог логиниться
--   произвольным "username" без реальной почты. Реальный email (если есть)
--   хранится в public.users.email как опциональное поле.
--
-- Применять ПОСЛЕ 03_auth_fixes.sql.
-- ============================================================================

-- ---------- 1. Колонка username ---------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username TEXT;

-- Backfill: username = часть email до @
UPDATE public.users
SET username = LOWER(SPLIT_PART(email, '@', 1))
WHERE username IS NULL AND email IS NOT NULL AND email <> '';

-- Если у кого-то по-прежнему нет username — поставим временный по uuid
UPDATE public.users
SET username = 'user_' || SUBSTRING(id::text, 1, 8)
WHERE username IS NULL OR username = '';

-- Уникальность (регистронезависимая)
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON public.users (LOWER(username));

-- Сделать username обязательным
ALTER TABLE public.users
  ALTER COLUMN username SET NOT NULL;

-- Чистка устаревших синтетических email (если 04 запускался ещё до 05)
-- безопасно: миграция 05 заполнит email из auth.users заново.
UPDATE public.users
SET email = NULL
WHERE email LIKE '%@aqbobek.local';


-- ---------- 2. RPC: проверить занятость логина (без сессии) -----------------
-- SELECT на public.users закрыт RLS, поэтому неавторизованным нужна SECURITY DEFINER функция.
CREATE OR REPLACE FUNCTION public.is_username_taken(p_username TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE LOWER(username) = LOWER(p_username)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Разрешим вызов из anon/authenticated
GRANT EXECUTE ON FUNCTION public.is_username_taken(TEXT) TO anon, authenticated;


-- ---------- 3. Обновлённый триггер handle_new_user --------------------------
-- Берёт username из user_metadata, email копирует как есть из auth.users.
-- (Окончательная версия триггера — в 05_login_via_username.sql.)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT;
  v_username  TEXT;
BEGIN
  v_full_name := NULLIF(NEW.raw_user_meta_data->>'full_name', '');
  v_username  := NULLIF(LOWER(NEW.raw_user_meta_data->>'username'), '');

  IF v_username IS NULL THEN
    v_username := LOWER(SPLIT_PART(NEW.email, '@', 1));
  END IF;

  INSERT INTO public.users (
    id, full_name, username, email, role, is_approved, has_acknowledged_rules
  )
  VALUES (
    NEW.id,
    COALESCE(v_full_name, v_username),
    v_username,
    NEW.email,
    'student',
    false,
    false
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Триггер уже создан в 03_auth_fixes.sql, но на всякий случай пересоздадим.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------- 4. View для админки (опционально) ------------------------------
-- Чтобы видеть synthetic email вместе с реальным — оставляем как есть в public.users.

-- ---------- 5. (опционально) сделать первого админа -------------------------
-- UPDATE public.users SET role='admin', is_approved=true, has_acknowledged_rules=true
-- WHERE username='admin_login';
