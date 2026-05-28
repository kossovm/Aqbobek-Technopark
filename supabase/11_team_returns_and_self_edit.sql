-- ============================================================================
-- 11_team_returns_and_self_edit.sql
--
-- 1. transactions.returned_by_user_id — кто фактически закрыл выдачу
--    (может отличаться от user_id, если возвращал сокомандник).
-- 2. RLS на projects: участники могут менять name/description/status
--    своих проектов (но НЕ cell_id и не удалять).
-- 3. RLS на project_members: участник видит составы своих команд.
-- 4. RLS на transactions: участник видит открытые транзакции по своим
--    проектам (для дашборда «Инвентарь команды»).
-- ============================================================================

-- ---------- 1. returned_by_user_id ------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS returned_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tx_returned_by ON public.transactions(returned_by_user_id);


-- ---------- 2. Helpers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.is_project_member(UUID) TO authenticated;


-- ---------- 3. RLS на projects: SELECT ---------------------------------------
DROP POLICY IF EXISTS "projects_select_member_or_staff" ON public.projects;
CREATE POLICY "projects_select_member_or_staff" ON public.projects
  FOR SELECT USING (
    public.is_staff()
    OR public.is_project_member(id)
  );

-- UPDATE: staff — без ограничений; участник — только базовые поля.
-- В Postgres нельзя ограничить набор колонок в RLS, но мы фильтруем триггером.
DROP POLICY IF EXISTS "projects_update_member_or_staff" ON public.projects;
CREATE POLICY "projects_update_member_or_staff" ON public.projects
  FOR UPDATE USING (
    public.is_staff()
    OR public.is_project_member(id)
  ) WITH CHECK (
    public.is_staff()
    OR public.is_project_member(id)
  );

-- Триггер запрещает участникам менять "опасные" поля
CREATE OR REPLACE FUNCTION public.guard_project_self_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_staff() THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_project_member(OLD.id) THEN
    RAISE EXCEPTION 'Нет доступа к этому проекту';
  END IF;

  -- Не-staff может менять только name, description, status
  IF NEW.cell_id IS DISTINCT FROM OLD.cell_id THEN
    RAISE EXCEPTION 'Менять ячейку проекта может только администратор';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_project_self_edit ON public.projects;
CREATE TRIGGER guard_project_self_edit
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_self_edit();


-- ---------- 4. RLS на project_members ---------------------------------------
DROP POLICY IF EXISTS "members_select_self_or_staff" ON public.project_members;
CREATE POLICY "members_select_self_or_staff" ON public.project_members
  FOR SELECT USING (
    public.is_staff()
    OR user_id = auth.uid()
    OR public.is_project_member(project_id)
  );


-- ---------- 5. RLS на transactions ------------------------------------------
DROP POLICY IF EXISTS "transactions_select_self_team_staff" ON public.transactions;
CREATE POLICY "transactions_select_self_team_staff" ON public.transactions
  FOR SELECT USING (
    public.is_staff()
    OR user_id = auth.uid()
    OR (project_id IS NOT NULL AND public.is_project_member(project_id))
  );
