-- ============================================================================
-- 07_fix_priv_trigger.sql
--
-- Проблема: prevent_privilege_escalation использует is_staff() → auth.uid().
-- Когда admin-create.ts обновляет профиль через service_role клиент,
-- auth.uid() = NULL → is_staff() = false → триггер бросает ошибку
-- "Изменение роли разрешено только staff", хотя это именно мы сами (сервер).
--
-- Решение: добавить проверку auth.role() = 'service_role' — если запрос
-- идёт через service_role ключ, он доверенный (серверный) и проходит мимо.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation()
RETURNS TRIGGER AS $$
BEGIN
  -- Запросы через service_role полностью доверенные (серверный код).
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Запросы от staff-сессии тоже разрешены.
  IF public.is_staff() THEN
    RETURN NEW;
  END IF;

  -- Обычный пользователь не может трогать чувствительные поля.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Изменение роли разрешено только staff';
  END IF;
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    RAISE EXCEPTION 'Изменение статуса подтверждения разрешено только staff';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Триггер уже существует, функция заменена выше — этого достаточно.
-- Но на всякий случай пересоздаём, чтобы убедиться что привязка свежая:
DROP TRIGGER IF EXISTS users_prevent_priv_esc ON public.users;
CREATE TRIGGER users_prevent_priv_esc
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_privilege_escalation();
