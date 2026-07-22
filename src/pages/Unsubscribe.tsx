import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "valid" | "already" | "invalid" | "success" | "error">("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    (async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
          headers: { apikey: SUPABASE_ANON_KEY },
        });
        const j = await r.json();
        if (j.valid) setState("valid");
        else if (j.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch { setState("error"); }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      setState(j.success ? "success" : j.reason === "already_unsubscribed" ? "already" : "error");
    } catch { setState("error"); }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="font-heading text-2xl text-foreground mb-2">BishopAI Sign</h1>
        {state === "loading" && <p className="text-muted-foreground">Checking your link…</p>}
        {state === "valid" && (
          <>
            <h2 className="font-heading text-xl mt-4 mb-2">Unsubscribe from emails?</h2>
            <p className="text-muted-foreground mb-6">You'll stop receiving emails from BishopAI Sign at this address.</p>
            <Button onClick={confirm} disabled={submitting} className="w-full">
              {submitting ? "Processing…" : "Confirm unsubscribe"}
            </Button>
          </>
        )}
        {state === "success" && <p className="mt-4">You've been unsubscribed.</p>}
        {state === "already" && <p className="mt-4 text-muted-foreground">This address is already unsubscribed.</p>}
        {state === "invalid" && <p className="mt-4 text-destructive">This unsubscribe link is invalid or expired.</p>}
        {state === "error" && <p className="mt-4 text-destructive">Something went wrong. Please try again.</p>}
      </div>
    </div>
  );
}
