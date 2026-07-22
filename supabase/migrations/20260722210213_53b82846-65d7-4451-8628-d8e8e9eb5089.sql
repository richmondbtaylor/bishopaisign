CREATE TABLE IF NOT EXISTS public.reissue_rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  email TEXT,
  document_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reissue_rate_limits_ip_created_idx ON public.reissue_rate_limits (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS reissue_rate_limits_email_created_idx ON public.reissue_rate_limits (email, created_at DESC);
GRANT ALL ON public.reissue_rate_limits TO service_role;
ALTER TABLE public.reissue_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.reissue_rate_limits FOR ALL USING (false) WITH CHECK (false);