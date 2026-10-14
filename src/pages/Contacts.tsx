import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Search, Pencil, Trash2 } from "lucide-react";

type Contact = { id: string; name: string | null; email: string; phone: string | null; company: string | null };
type Draft = { id?: string; name: string; email: string; phone: string; company: string };
const empty: Draft = { name: "", email: "", phone: "", company: "" };

export default function Contacts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    const { data } = await supabase.from("contacts").select("id, name, email, phone, company").order("name", { ascending: true, nullsFirst: false });
    setContacts(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => [c.name, c.email, c.company, c.phone].some(v => v?.toLowerCase().includes(q)));
  }, [contacts, search]);

  const save = async () => {
    if (!draft || !user) return;
    const email = draft.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    const row = { owner_id: user.id, email, name: draft.name.trim() || null, phone: draft.phone.trim() || null, company: draft.company.trim() || null };
    const { error } = draft.id
      ? await supabase.from("contacts").update(row).eq("id", draft.id)
      : await supabase.from("contacts").upsert(row, { onConflict: "owner_id,email" });
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    setDraft(null);
    load();
  };

  const remove = async (c: Contact) => {
    if (!confirm(`Delete ${c.name || c.email}?`)) return;
    await supabase.from("contacts").delete().eq("id", c.id);
    load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3 flex items-center gap-2">
        <Link to="/dashboard"><Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft className="w-4 h-4" /></Button></Link>
        <h1 className="font-heading text-lg font-semibold text-foreground flex-1">Contacts</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setDraft({ ...empty })}><Plus className="w-4 h-4" /> Add contact</Button>
      </header>
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <p className="text-sm text-muted-foreground">Everyone you send documents to is saved here automatically and suggested when you add signers.</p>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts" className="pl-9" />
        </div>
        {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{contacts.length ? "No matching contacts." : "No contacts yet."}</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-lg bg-card">
            {filtered.map(c => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{c.name || c.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{[c.name ? c.email : null, c.company, c.phone].filter(Boolean).join(" · ")}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Edit contact" onClick={() => setDraft({ id: c.id, name: c.name || "", email: c.email, phone: c.phone || "", company: c.company || "" })}><Pencil className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Delete contact" onClick={() => remove(c)}><Trash2 className="w-4 h-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{draft?.id ? "Edit contact" : "Add contact"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              {(["name", "email", "phone", "company"] as const).map(k => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`c-${k}`} className="capitalize">{k}</Label>
                  <Input id={`c-${k}`} type={k === "email" ? "email" : "text"} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
