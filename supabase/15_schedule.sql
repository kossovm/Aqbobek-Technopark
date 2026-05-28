-- ============================================================================
-- 15_schedule.sql
--
-- Расписание технопарка.
--   * schedule_events — базовые события (название, описание, класс/группа,
--     день недели, время начала и конца, автор).
--   * Автор — any approved user.
--   * Удалять чужое может только admin (через RLS / application-level check).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.schedule_events (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title       TEXT        NOT NULL,
  description TEXT,
  class_group TEXT,                       -- класс / группа, напр. «10А» или «Robotics»
  day_of_week SMALLINT    NOT NULL        -- 1=Пн, 2=Вт ... 7=Вс (ISO)
              CHECK (day_of_week BETWEEN 1 AND 7),
  time_start  TIME        NOT NULL,       -- «09:00»
  time_end    TIME,                       -- «10:30» (опционально)
  author_id   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()   NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()   NOT NULL
);

ALTER TABLE public.schedule_events ENABLE ROW LEVEL SECURITY;

-- Читать может любой авторизованный одобренный пользователь
DROP POLICY IF EXISTS "schedule_select_approved" ON public.schedule_events;
CREATE POLICY "schedule_select_approved" ON public.schedule_events
  FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

-- Вставлять может любой одобренный
DROP POLICY IF EXISTS "schedule_insert_approved" ON public.schedule_events;
CREATE POLICY "schedule_insert_approved" ON public.schedule_events
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND public.is_approved());

-- Обновлять может только сам автор или staff
DROP POLICY IF EXISTS "schedule_update_own_or_staff" ON public.schedule_events;
CREATE POLICY "schedule_update_own_or_staff" ON public.schedule_events
  FOR UPDATE USING (auth.uid() = author_id OR public.is_staff());

-- Удалять может только staff (admin/teacher)
DROP POLICY IF EXISTS "schedule_delete_staff" ON public.schedule_events;
CREATE POLICY "schedule_delete_staff" ON public.schedule_events
  FOR DELETE USING (public.is_staff());

CREATE INDEX IF NOT EXISTS idx_schedule_day ON public.schedule_events(day_of_week, time_start);
CREATE INDEX IF NOT EXISTS idx_schedule_author ON public.schedule_events(author_id);
