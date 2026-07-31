import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Copy, Mail, Trash2, UserPlus, Users, Share2 } from "lucide-react";
import { format } from "date-fns";

type Member = { id: string; user_id: string; role: string; created_at: string; full_name?: string | null };
type Invite = { id: string; email: string; role: string; token: string; status: string; created_at: string };

const publicOrigin = () =>
  typeof window !== "undefined" && window.location.hostname.includes("lovableproject.com")
    ? "https://bishopaisign.lovable.app"
    : window.location.origin;

const Team = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [myInvites, setMyInvites] = useState<Invite[]>([]);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    const oid = membership?.organization_id ?? null;
    setOrgId(oid);
    setIsAdmin(membership?.role === "admin");

    if (oid) {
      const [orgRes, memRes, invRes] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", oid).maybeSingle(),
        supabase.from("organization_members").select("*").eq("organization_id", oid).order("created_at"),
        supabase.from("organization_invitations").select("*").eq("organization_id", oid).order("created_at", { ascending: false }),
      ]);
      setOrgName(orgRes.data?.name || "");
      const mem = (memRes.data as Member[]) || [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", mem.map((m) => m.user_id));
      const nameById: Record<string, string | null> = {};
      (profs || []).forEach((p: any) => (nameById[p.user_id] = p.full_name));
      setMembers(mem.map((m) => ({ ...m, full_name: nameById[m.user_id] })));
      setInvites((invRes.data as Invite[]) || []);
    } else {
      const { data: mine } = await supabase
        .from("organization_invitations")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setMyInvites((mine as Invite[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Auto-accept an invite link
  useEffect(() => {
    const token = params.get("invite");
    if (!token || !user || loading) return;
    (async () => {
      const { error } = await supabase.rpc("accept_org_invitation", { _token: token });
      if (error) {
        toast({ title: "Could not accept invitation", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Welcome to the workspace", description: "You now share templates and documents with your team." });
      }
      params.delete("invite");
      setParams(params, { replace: true });
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, user, loading]);

  const createWorkspace = async () => {
    if (!user || !newWorkspace.trim()) return;
    setBusy(true);
    const { data: org, error } = await supabase
      .from("organizations")
      .insert({ name: newWorkspace.trim() })
      .select("id")
      .single();
    if (error || !org) {
      setBusy(false);
      toast({ title: "Could not create workspace", description: error?.message, variant: "destructive" });
      return;
    }
    await supabase.from("organization_members").insert({ organization_id: org.id, user_id: user.id, role: "admin" });
    await supabase.from("profiles").update({ organization_id: org.id }).eq("user_id", user.id);
    setBusy(false);
    setNewWorkspace("");
    toast({ title: "Workspace created", description: "Invite teammates to share templates and documents." });
    load();
  };

  const inviteLink = (token: string) => `${publicOrigin()}/team?invite=${token}`;

  const sendInvite = async () => {
    if (!orgId || !user) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("organization_invitations")
      .insert({ organization_id: orgId, email, invited_by: user.id, role: "member" })
      .select("*")
      .single();
    setBusy(false);
    if (error || !data) {
      toast({ title: "Could not create invitation", description: error?.message, variant: "destructive" });
      return;
    }
    setInviteEmail("");
    await navigator.clipboard.writeText(inviteLink(data.token)).catch(() => {});
    toast({ title: "Invitation created", description: `Invite link copied. Send it to ${email}.` });
    load();
  };

  const revokeInvite = async (id: string) => {
    await supabase.from("organization_invitations").delete().eq("id", id);
    load();
  };

  const shareExisting = async () => {
    if (!orgId || !user) return;
    setBusy(true);
    await supabase.from("templates").update({ organization_id: orgId }).eq("creator_id", user.id).is("organization_id", null);
    await supabase.from("documents").update({ organization_id: orgId }).eq("sender_id", user.id).is("organization_id", null);
    setBusy(false);
    toast({ title: "Shared with workspace", description: "Your templates and documents are visible to teammates." });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center">
          <Link to="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-primary" />
            <h1 className="font-heading text-2xl font-bold text-foreground">Team</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Invite teammates to your workspace so they can see your shared templates and documents.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading workspace...</p>
        ) : !orgId ? (
          <div className="space-y-6">
            <div className="border border-border rounded-lg p-5 bg-card">
              <h2 className="font-heading font-semibold text-foreground mb-1">Create a workspace</h2>
              <p className="text-sm text-muted-foreground mb-4">
                A workspace lets you share templates and documents with teammates.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Acme Legal"
                  value={newWorkspace}
                  onChange={(e) => setNewWorkspace(e.target.value)}
                />
                <Button onClick={createWorkspace} disabled={busy || !newWorkspace.trim()}>Create</Button>
              </div>
            </div>

            {myInvites.length > 0 && (
              <div className="border border-border rounded-lg p-5 bg-card">
                <h2 className="font-heading font-semibold text-foreground mb-3">Invitations for you</h2>
                <div className="space-y-2">
                  {myInvites.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">
                        Invited {format(new Date(i.created_at), "MMM d, yyyy")}
                      </span>
                      <Button
                        size="sm"
                        onClick={async () => {
                          const { error } = await supabase.rpc("accept_org_invitation", { _token: i.token });
                          if (error) toast({ title: "Could not accept", description: error.message, variant: "destructive" });
                          else load();
                        }}
                      >
                        Join workspace
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="border border-border rounded-lg p-5 bg-card">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-heading font-semibold text-foreground">{orgName}</h2>
                  <p className="text-sm text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-2" onClick={shareExisting} disabled={busy}>
                  <Share2 className="w-4 h-4" /> Share my templates and documents
                </Button>
              </div>
              <div className="divide-y divide-border">
                {members.map((m) => (
                  <div key={m.id} className="py-2 flex items-center justify-between">
                    <span className="text-sm text-foreground">
                      {m.full_name || (m.user_id === user?.id ? user?.email : "Teammate")}
                      {m.user_id === user?.id && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                    <Badge variant="outline" className="capitalize">{m.role}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {isAdmin && (
              <div className="border border-border rounded-lg p-5 bg-card">
                <h2 className="font-heading font-semibold text-foreground mb-1">Invite a teammate</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  We create a private invite link and copy it to your clipboard. Send it to your teammate; they join after signing up with that email.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <Button onClick={sendInvite} disabled={busy} className="gap-2">
                    <UserPlus className="w-4 h-4" /> Invite
                  </Button>
                </div>

                {invites.length > 0 && (
                  <div className="mt-5 divide-y divide-border">
                    {invites.map((i) => (
                      <div key={i.id} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground flex items-center gap-2 truncate">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground" /> {i.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {i.status === "accepted" ? "Accepted" : "Pending"} - {format(new Date(i.created_at), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {i.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1"
                                onClick={() => {
                                  navigator.clipboard.writeText(inviteLink(i.token));
                                  toast({ title: "Invite link copied" });
                                }}
                              >
                                <Copy className="w-4 h-4" /> Copy link
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => revokeInvite(i.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Team;
