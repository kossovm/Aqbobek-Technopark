-- 1. Таблица логов списания
CREATE TABLE public.consumable_usage (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  consumable_id UUID REFERENCES public.consumables(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
  proof_image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Включаем RLS
ALTER TABLE public.consumable_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consumable usage" ON public.consumable_usage FOR SELECT USING (auth.uid() = user_id OR public.is_staff());
CREATE POLICY "Users can insert consumable usage" ON public.consumable_usage FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3. Создаем Storage Bucket "proofs" для скриншотов
INSERT INTO storage.buckets (id, name, public) 
VALUES ('proofs', 'proofs', true)
ON CONFLICT (id) DO NOTHING;

-- 4. RLS Политики для Storage
-- Любой желающий может просматривать загруженные доказательства (так как бакет публичный)
CREATE POLICY "Proofs are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'proofs');
-- Только авторизованные могут загружать файлы
CREATE POLICY "Authenticated users can upload proofs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'proofs' AND auth.role() = 'authenticated');

-- 5. RPC Функция для атомарного вычитания остатков (чтобы не было Race Condition при обновлении)
CREATE OR REPLACE FUNCTION public.decrement_consumable(c_id UUID, amount_to_subtract DECIMAL)
RETURNS void AS $$
BEGIN
  UPDATE public.consumables
  SET quantity_in_stock = quantity_in_stock - amount_to_subtract
  WHERE id = c_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
