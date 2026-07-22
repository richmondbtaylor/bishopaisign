import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  FileSignature, ArrowLeft, LayoutTemplate, Plus, Trash2, FileText, Clock,
} from "lucide-react";
import { format } from "date-fns";

type Template = {
  id: string;
  name: string;
  description: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
};

const Templates = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .order("updated_at", { ascending: false });

    if (!error && data) setTemplates(data);
    setLoading(false);
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (!error) {
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: "Template deleted" });
    }
  };

  const useTemplate = async (template: Template) => {
    if (!user) return;
    try {
      // Create a new document from the template
      const { data: doc, error } = await supabase.from("documents").insert({
        title: `${template.name} - Copy`,
        sender_id: user.id,
        file_path: template.file_path,
        template_id: template.id,
        status: "draft",
      }).select().single();

      if (error) throw error;

      // Copy template fields to document fields
      const { data: templateFields } = await supabase
        .from("template_fields")
        .select("*")
        .eq("template_id", template.id);

      if (templateFields?.length && doc) {
        await supabase.from("document_fields").insert(
          templateFields.map(f => ({
            document_id: doc.id,
            type: f.type,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            page_number: f.page_number,
            label: f.label,
            required: f.required,
            placeholder: f.placeholder,
            options: f.options,
          }))
        );
      }

      toast({ title: "Document created from template" });
      navigate(`/documents/${doc.id}/edit`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <FileSignature className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-heading text-lg font-bold text-foreground">BishopAI Sign</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-2xl font-bold text-foreground">Templates</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Reuse document layouts with pre-configured fields.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-xl">
            <LayoutTemplate className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-lg font-semibold text-foreground mb-1">No templates yet</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Templates will appear here when you save a document as a template from the editor.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(template => (
              <div key={template.id} className="border border-border rounded-xl p-5 bg-card hover:shadow-elevated transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <LayoutTemplate className="w-5 h-5 text-primary" />
                  </div>
                  <button
                    onClick={() => deleteTemplate(template.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="font-heading font-semibold text-foreground mb-1">{template.name}</h3>
                {template.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                  <Clock className="w-3 h-3" />
                  {format(new Date(template.updated_at), "MMM d, yyyy")}
                </div>
                <Button size="sm" className="w-full gap-2" onClick={() => useTemplate(template)}>
                  <FileText className="w-3.5 h-3.5" /> Use Template
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Templates;
