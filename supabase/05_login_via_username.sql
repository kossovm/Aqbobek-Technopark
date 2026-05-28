-- ============================================================================
-- 05_login_via_username.sql
--
-- Зачем:
--   Supabase Auth не пропускает домен .local — это RFC-зарезервированная
--   зона mDNS. При попытке signUp возвращает "<email> is invalid".
--
-- Что делаем:
--   1. Меняем синтетический домен с aqbobek.local на aqbobek.kz во всех
--      существующих auth.users и public.users.
--   2. Триггер handle_new_user теперь всегда копирует email из auth.users
--      в public.users (не разделяя «реальный/синтетический» — для UI это
--      разделение делается на клиенте по суффиксу домена).
--   3. RPC get_login_email(username) возвращает email авторизации, чтобы
--      форма входа могла залогинить юзера по логину.
--
-- Применять ПОСЛЕ 04_username_login.sql.
-- ============================================================================

-- ---------- 1. Бэкфилл существующих синтетических email ---------------------
-- Внимание: меняем строку напрямую в auth.users. Это безопасно: GoTrue
-- сравнивает email регистронезависимо и при следующем signIn пользователь
-- сможет войти с новым доменом.
UPDATE auth.users
SET email = REPLACE(email, '@aqbobek.local', '@aqbobek.kz')
WHERE email LIKE '%@aqbobek.local';

-- На случай, если в email_change_*-полях тоже остались хвосты (редко):
UPDATE auth.users
SET email_change      = REPLACE(email_change, '@aqbobek.local', '@aqbobek.kz')
WHERE email_change LIKE '%@aqbobek.local';

-- В public.users.email раньше мы зануляли синтетические — заполним их
-- по факту того, что лежит в auth.users (там уже @aqbobek.kz).
UPDATE public.users u
SET email = au.email
FROM auth.users au
WHERE u.id = au.id AND (u.email IS NULL OR u.email = '');


-- ---------- 2. Обновлённый триггер ------------------------------------------
-- Email просто копируется как есть — ничего не зануляем. UI скрывает
-- @aqbobek.kz сам, по суффиксу.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------- 3. RPC: получить email для логина по username -------------------
-- Возвращает auth.users.email (то, что Supabase ждёт в signInWithPassword).
-- SECURITY DEFINER — обходит RLS, чтобы login-форма могла этим пользоваться.
CREATE OR REPLACE FUNCTION public.get_login_email(p_username TEXT)
RETURNS TEXT AS $$
  SELECT au.email
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE LOWER(u.username) = LOWER(p_username)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_login_email(TEXT) TO anon, authenticated;


-- ---------- 4. Заметка ------------------------------------------------------
-- Если в Supabase включён Email Domain Allowlist (Auth → Providers → Email),
-- добавьте туда aqbobek.kz, иначе валидация продолжит блокировать
-- синтетические аккаунты.
