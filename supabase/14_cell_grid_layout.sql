-- ============================================================================
-- 14_cell_grid_layout.sql
--
-- Каждая локация (шкаф/стол) теперь может иметь логическую сетку:
--   * locations.grid_rows / grid_cols  — размер сетки (NULL → сетки нет, плоский список).
--   * cells.position_row / position_col — позиция ячейки в этой сетке (NULL → не размещена).
--
-- Это нужно только для UX: визуально расположить ячейки так же, как они стоят
-- физически. Не все слоты сетки обязательно заполнены.
-- ============================================================================

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS grid_rows INT,
  ADD COLUMN IF NOT EXISTS grid_cols INT;

ALTER TABLE public.cells
  ADD COLUMN IF NOT EXISTS position_row INT,
  ADD COLUMN IF NOT EXISTS position_col INT;

-- Уникальность: одна позиция в локации не может быть занята дважды
CREATE UNIQUE INDEX IF NOT EXISTS uq_cell_position_per_location
  ON public.cells(location_id, position_row, position_col)
  WHERE position_row IS NOT NULL AND position_col IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cells_position
  ON public.cells(location_id, position_row, position_col);
