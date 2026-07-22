
-- Percent-based coordinates for field placement (page-relative, resolution-independent)
ALTER TABLE public.document_fields
  ADD COLUMN IF NOT EXISTS x_pct double precision,
  ADD COLUMN IF NOT EXISTS y_pct double precision,
  ADD COLUMN IF NOT EXISTS w_pct double precision,
  ADD COLUMN IF NOT EXISTS h_pct double precision;

-- Decline tracking on documents + signers
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS declined_by_signer_id uuid;

ALTER TABLE public.document_signers
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text;

-- Fast lookup for ordering checks
CREATE INDEX IF NOT EXISTS document_signers_doc_order_idx
  ON public.document_signers (document_id, signing_order);
