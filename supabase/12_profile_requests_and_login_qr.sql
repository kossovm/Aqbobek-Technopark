-- ============================================================================
-- 12_profile_requests_and_login_qr.sql
--
-- 1. profile_change_requests — заявки на изменение профиля
--    (full_name, class, email). Применяются админом/учителем.
--    Пока есть pending-заявка от пользователя — он не может подать новую
--    и не может ничего менять напрямую.
--
-- 2. users.login_qr_token — уникальный токен для входа по QR-коду.
--    Генерируется автоматически при создании пользователя.
--    При компрометации перевыпускается одной кнопкой (без подтверждения).
-- ============================================================================

-- ---------- 1. login_qr_token -----------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS login_qr_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_login_qr ON public.users(login_qr_token);

-- Простая функция генерации длинного токена.
CREATE OR REPLACE FUNCTION public.gen_login_qr_token()
RETURNS TEXT AS $$
  -- 'LOGIN-' + 24 символа base32 от случайного UUID.
  -- Достаточно длинный, чтобы не угадать.
  SELECT 'LOGIN-' || REPLACE(REPLACE(REPLACE(
            ENCODE(gen_random_bytes(18), 'base64'),
            '/', ''), '+', ''), '=', '');
$$ LANGUAGE sql VOLATILE;

-- Бэкфилл существующих пользователей
UPDATE public.users
SET login_qr_token = public.gen_login_qr_token()
WHERE login_qr_token IS NULL;


-- ---------- 2. handle_new_user: добавляем токен -----------------------------
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
    class, requested_role, login_qr_token
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
    v_req_role,
    public.gen_login_qr_token()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------- 3. Таблица заявок на смену профиля ------------------------------
CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_full_name TEXT,
  requested_class     TEXT,
  requested_email     TEXT,
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected')),
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reject_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_pcr_profile_user   ON public.profile_change_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_pcr_profile_status ON public.profile_change_requests(status);

ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_req_select" ON public.profile_change_requests;
CREATE POLICY "profile_req_select" ON public.profile_change_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_staff());

DROP POLICY IF EXISTS "profile_req_insert_own" ON public.profile_change_requests;
CREATE POLICY "profile_req_insert_own" ON public.profile_change_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Пользователь может отменить (delete) свою pending-заявку;
-- staff может удалять любые.
DROP POLICY IF EXISTS "profile_req_delete_own_or_staff" ON public.profile_change_requests;
CREATE POLICY "profile_req_delete_own_or_staff" ON public.profile_change_requests
  FOR DELETE USING (
    public.is_staff()
    OR (auth.uid() = user_id AND status = 'pending')
  );

-- Обновлять (approve/reject) может только staff
DROP POLICY IF EXISTS "profile_req_update_staff" ON public.profile_change_requests;
CREATE POLICY "profile_req_update_staff" ON public.profile_change_requests
  FOR UPDATE USING (public.is_staff());


-- ---------- 4. RPC: получить QR-токен по username (если нужно для login) ----
-- Сделано через RPC, потому что неавторизованный клиент не может читать
-- public.users из-за RLS.
CREATE OR REPLACE FUNCTION public.get_email_by_login_qr(p_token TEXT)
RETURNS TEXT AS $$
  SELECT email FROM public.users WHERE login_qr_token = p_token LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_email_by_login_qr(TEXT) TO anon, authenticated;
