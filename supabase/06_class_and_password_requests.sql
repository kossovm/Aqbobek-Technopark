-- ============================================================================
-- 06_class_and_password_requests.sql
--
-- 1. Поля class (класс, напр. "10А") и requested_role ("student"/"teacher")
--    в public.users — приходят из формы регистрации.
-- 2. Таблица password_change_requests:
--    - Авторизованный пользователь создаёт заявку на смену пароля.
--    - Неавторизованный (забыл пароль) — через RPC.
--    - Администратор одобряет (Admin API применяет пароль) или отклоняет.
--    - Пока заявка pending — старый пароль работает.
-- 3. Обновляем триггер handle_new_user: читаем class и requested_role из metadata.
-- ============================================================================

-- ---------- 1. Новые колонки в public.users ---------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS class TEXT,
  ADD COLUMN IF NOT EXISTS requested_role TEXT DEFAULT 'student';


-- ---------- 2. Обновляем триггер handle_new_user ----------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name    TEXT;
  v_username     TEXT;
  v_class        TEXT;
  v_req_role     TEXT;
BEGIN
  v_full_name := NULLIF(NEW.raw_user_meta_data->>'full_name', '');
  v_username  := NULLIF(LOWER(NEW.raw_user_meta_data->>'username'), '');
  v_class     := NULLIF(NEW.raw_user_meta_data->>'class', '');
  v_req_role  := COALESCE(NULLIF(NEW.raw_user_meta_data->>'requested_role', ''), 'student');

  IF v_username IS NULL THEN
    v_username := LOWER(SPLIT_PART(NEW.email, '@', 1));
  END IF;

  INSERT INTO public.users (
    id, full_name, username, email,
    role, is_approved, has_acknowledged_rules,
    class, requested_role
  )
  VALUES (
    NEW.id,
    COALESCE(v_full_name, v_username),
    v_username,
    NEW.email,
    'student',
    false,
    false,
    v_class,
    v_req_role
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ---------- 3. Таблица password_change_requests -----------------------------
CREATE TABLE IF NOT EXISTS public.password_change_requests (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id      UUID REFERENCES public.users(id) ON DELETE CASCADE,
  username     TEXT NOT NULL,
  new_password TEXT NOT NULL,
  type         TEXT DEFAULT 'change' CHECK (type IN ('change', 'reset')),
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES public.users(id)
);

ALTER TABLE public.password_change_requests ENABLE ROW LEVEL SECURITY;

-- Пользователь видит только свои заявки; staff видит все
CREATE POLICY "pcr_select" ON public.password_change_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff());

-- Авторизованный пользователь может создавать заявки только от своего имени
CREATE POLICY "pcr_insert_own" ON public.password_change_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id AND user_id IS NOT NULL);

-- Обновлять (approve/reject) может только staff
CREATE POLICY "pcr_update_staff" ON public.password_change_requests
  FOR UPDATE USING (public.is_staff());


-- ---------- 4. RPC для неавторизованного сброса пароля ----------------------
-- Нужно для случая "я забыл пароль и не могу войти".
-- SECURITY DEFINER — обходит RLS; rate-limiting на уровне приложения.
CREATE OR REPLACE FUNCTION public.submit_password_reset_request(
  p_username     TEXT,
  p_new_password TEXT,
  p_note         TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_pending_count INT;
BEGIN
  -- Ищем пользователя
  SELECT id INTO v_user_id
  FROM public.users
  WHERE LOWER(username) = LOWER(p_username)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Пользователь с таким логином не найден');
  END IF;

  -- Не больше 3 одновременных pending-заявок от одного пользователя
  SELECT COUNT(*) INTO v_pending_count
  FROM public.password_change_requests
  WHERE user_id = v_user_id AND status = 'pending';

  IF v_pending_count >= 3 THEN
    RETURN jsonb_build_object('error', 'Уже есть необработанные заявки на смену пароля. Дождитесь ответа администратора.');
  END IF;

  IF LENGTH(p_new_password) < 6 THEN
    RETURN jsonb_build_object('error', 'Пароль должен быть не короче 6 символов');
  END IF;

  INSERT INTO public.password_change_requests (user_id, username, new_password, type, note)
  VALUES (v_user_id, LOWER(p_username), p_new_password, 'reset', p_note);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.submit_password_reset_request(TEXT, TEXT, TEXT) TO anon, authenticated;
