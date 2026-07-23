import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

async function sendWelcomeIfNeeded(user: User) {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("welcome_email_sent_at, full_name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile || profile.welcome_email_sent_at) return;
    const fullName = (profile.full_name as string | null) || (user.user_metadata?.full_name as string | undefined) || user.email || "";
    const firstName = fullName.split(" ")[0]?.split("@")[0] || "there";
    await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "welcome",
        recipientEmail: user.email,
        idempotencyKey: `welcome-${user.id}`,
        templateData: { firstName, plan: "Free", ctaUrl: `${window.location.origin}/dashboard` },
      },
    });
    await supabase
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("user_id", user.id);
  } catch (e) {
    console.warn("welcome email send failed", e);
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setLoading(false);
        if (event === "SIGNED_IN" && session?.user) {
          // Fire welcome email once per user (defer to avoid deadlock in the callback).
          setTimeout(() => sendWelcomeIfNeeded(session.user), 0);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
};
