import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

const PIN = "8226";
const STORAGE_KEY = "bishop_pin_ok";
const LENGTH = 4;

export function PinGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(() =>
    typeof window !== "undefined" && sessionStorage.getItem(STORAGE_KEY) === "1"
  );
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [error, setError] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!unlocked) refs.current[0]?.focus();
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  const submit = (code: string) => {
    if (code === PIN) {
      sessionStorage.setItem(STORAGE_KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
      setDigits(Array(LENGTH).fill(""));
      setTimeout(() => refs.current[0]?.focus(), 0);
    }
  };

  const handleChange = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "").slice(0, 1);
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    setError(false);
    if (clean && i < LENGTH - 1) refs.current[i + 1]?.focus();
    if (next.every((d) => d !== "")) submit(next.join(""));
  };

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = text.padEnd(LENGTH, "").split("").slice(0, LENGTH);
    setDigits(next);
    if (next.every((d) => d !== "")) submit(next.join(""));
    else refs.current[Math.min(text.length, LENGTH - 1)]?.focus();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md p-8 md:p-10 rounded-3xl border-border/60 shadow-lg bg-card">
        <div className="flex flex-col items-center text-center">
          <div className="h-14 w-14 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center mb-5">
            <Lock className="h-6 w-6 text-foreground" />
          </div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Enter access PIN</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            A 4-digit code is required to open the dashboard.
          </p>

          <div className="flex gap-3 mt-8" onPaste={handlePaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => (refs.current[i] = el)}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={`PIN digit ${i + 1}`}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                className={`h-16 w-14 md:h-20 md:w-16 rounded-2xl border-2 bg-background text-center text-2xl md:text-3xl font-heading font-semibold outline-none transition-colors ${
                  error
                    ? "border-destructive text-destructive"
                    : "border-border focus:border-accent focus:ring-4 focus:ring-accent/20"
                }`}
              />
            ))}
          </div>

          <p
            role="alert"
            aria-live="assertive"
            className={`mt-4 text-sm min-h-[1.25rem] ${error ? "text-destructive" : "text-transparent"}`}
          >
            Incorrect PIN. Try again.
          </p>

          <Button
            variant="ghost"
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setDigits(Array(LENGTH).fill(""));
              setError(false);
              refs.current[0]?.focus();
            }}
          >
            Clear
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default PinGate;
