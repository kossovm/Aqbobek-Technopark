-- ============================================================================
-- 13_consumable_usage_unified.sql
--
-- Расходники теперь живут в public.inventory (is_consumable = true).
-- Старая таблица public.consumables была отдельной — её записи никуда не идут.
-- Унифицируем consumable_usage:
--   * inventory_id      — основной FK на inventory(id);
--   * consumable_id     — старое поле, делаем nullable для обратной совместимости;
--   * teacher_approver_id — кто разрешил списание (актуально для blue/purple ячеек
--     или просто как ссылка на учителя; для самих учителей = они сами).
-- ============================================================================

ALTER TABLE public.consumable_usage
  ADD COLUMN IF NOT EXISTS inventory_id        UUID REFERENCES public.inventory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS teacher_approver_id UUID REFERENCES public.users(id)     ON DELETE SET NULL;

-- consumable_id больше не обязателен (новые записи будут с inventory_id)
ALTER TABLE public.consumable_usage
  ALTER COLUMN consumable_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cu_inventory ON public.consumable_usage(inventory_id);
CREATE INDEX IF NOT EXISTS idx_cu_user      ON public.consumable_usage(user_id);
