-- ============================================================================
-- 10_cells_and_map.sql
--
-- Карта инвентаря: ячейки внутри локаций.
--
-- Цвета и правила доступа:
--   green   — свободно для всех
--   blue    — для своего проекта или с разрешения учителя
--   purple  — только для учителей; ученикам — с указанием учителя-разрешителя
--
-- Ключевые изменения:
--   1. Таблица cells (location_id, code "И02", color, qr_code "CELL-XXXX").
--   2. locations.image_url — карта-картинка (4:3 рекомендуется).
--   3. inventory.home_cell_id — постоянный «дом» предмета (ячейка).
--   4. projects.cell_id — синяя ячейка проекта (заменяет box_location_id).
--   5. transactions.teacher_approver_id — кто разрешил (для blue/purple).
--   6. Storage bucket location-maps.
-- ============================================================================

-- ---------- 1. Таблица ячеек -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cells (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  location_id   UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,                                -- "И02", "П01"
  color         TEXT NOT NULL DEFAULT 'green'
                CHECK (color IN ('green','blue','purple')),
  qr_code       TEXT NOT NULL UNIQUE,                         -- "CELL-XXXX"
  label_printed BOOLEAN DEFAULT false NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (location_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cells_location ON public.cells(location_id);
CREATE INDEX IF NOT EXISTS idx_cells_color    ON public.cells(color);

ALTER TABLE public.cells ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cells_select_all" ON public.cells;
CREATE POLICY "cells_select_all" ON public.cells
  FOR SELECT USING (auth.role() = 'authenticated' AND public.is_approved());

DROP POLICY IF EXISTS "cells_modify_staff" ON public.cells;
CREATE POLICY "cells_modify_staff" ON public.cells
  FOR ALL USING (public.is_staff());


-- ---------- 2. Картинка локации ---------------------------------------------
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS image_url TEXT;


-- ---------- 3. Inventory: home cell ------------------------------------------
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS home_cell_id UUID REFERENCES public.cells(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_home_cell ON public.inventory(home_cell_id);


-- ---------- 4. Projects: ячейка проекта (синяя) ------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cell_id UUID REFERENCES public.cells(id) ON DELETE SET NULL;


-- ---------- 5. Transactions: разрешивший учитель -----------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS teacher_approver_id UUID REFERENCES public.users(id) ON DELETE SET NULL;


-- ---------- 6. Storage bucket для карт локаций -------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('location-maps', 'location-maps', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "location_maps_public_read" ON storage.objects;
CREATE POLICY "location_maps_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'location-maps');

DROP POLICY IF EXISTS "location_maps_staff_upload" ON storage.objects;
CREATE POLICY "location_maps_staff_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'location-maps' AND public.is_staff());

DROP POLICY IF EXISTS "location_maps_staff_update" ON storage.objects;
CREATE POLICY "location_maps_staff_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'location-maps' AND public.is_staff());

DROP POLICY IF EXISTS "location_maps_staff_delete" ON storage.objects;
CREATE POLICY "location_maps_staff_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'location-maps' AND public.is_staff());


-- ---------- 7. Helper: только синие свободные ячейки -------------------------
CREATE OR REPLACE FUNCTION public.available_blue_cells()
RETURNS TABLE (
  id UUID,
  location_id UUID,
  code TEXT,
  qr_code TEXT,
  location_name TEXT
) AS $$
  SELECT c.id, c.location_id, c.code, c.qr_code, l.name
  FROM public.cells c
  JOIN public.locations l ON l.id = c.location_id
  WHERE c.color = 'blue'
    AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.cell_id = c.id)
  ORDER BY l.name, c.code;
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.available_blue_cells() TO authenticated;
