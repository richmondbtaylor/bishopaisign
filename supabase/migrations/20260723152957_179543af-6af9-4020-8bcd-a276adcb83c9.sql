
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  product_id TEXT,
  price_id TEXT NOT NULL,
  plan TEXT,
  billing_interval TEXT,
  status TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

CREATE TABLE public.bulk_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_batches TO authenticated;
GRANT ALL ON public.bulk_batches TO service_role;
ALTER TABLE public.bulk_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sender manages own bulk batches" ON public.bulk_batches
  FOR ALL TO authenticated USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);
CREATE TRIGGER update_bulk_batches_updated_at BEFORE UPDATE ON public.bulk_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.bulk_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.bulk_batches(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bulk_recipients_batch ON public.bulk_recipients(batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_recipients TO authenticated;
GRANT ALL ON public.bulk_recipients TO service_role;
ALTER TABLE public.bulk_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sender views own bulk recipients" ON public.bulk_recipients
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bulk_batches b WHERE b.id = batch_id AND b.sender_id = auth.uid()));

CREATE TABLE public.document_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  signer_id UUID NOT NULL REFERENCES public.document_signers(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_document_reminders_due ON public.document_reminders(scheduled_for) WHERE sent_at IS NULL;
GRANT SELECT ON public.document_reminders TO authenticated;
GRANT ALL ON public.document_reminders TO service_role;
ALTER TABLE public.document_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sender views reminders" ON public.document_reminders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.sender_id = auth.uid()));
