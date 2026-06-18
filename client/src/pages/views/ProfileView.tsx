import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export function ProfileView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cvText, setCvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data: profile } = useQuery<{ cvText: string }>({
    queryKey: ["/api/profile"],
    queryFn: () => apiRequest("GET", "/api/profile").then((r) => r.json()),
  });

  useEffect(() => {
    if (profile?.cvText !== undefined && !dirty) setCvText(profile.cvText);
  }, [profile, dirty]);

  async function save() {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/profile", { cvText });
      await queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setDirty(false);
      toast({ title: "CV saved." });
    } catch {
      toast({ title: "Couldn't save", description: "Try again in a moment." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-0.5">Profile</h2>
        <p className="text-sm text-muted-foreground">We'll use your CV to suggest specific bullet rewrites for each job you apply to.</p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">Your CV</p>
          <p className="text-xs text-muted-foreground mb-2">Paste your CV text. When you apply for jobs, we'll suggest specific wording based on what each role needs — not generic advice.</p>
          <textarea
            value={cvText}
            onChange={(e) => { setCvText(e.target.value); setDirty(true); }}
            placeholder="Paste your CV here…"
            className="w-full min-h-[360px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y font-mono text-xs leading-relaxed"
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{cvText.length > 0 ? `${cvText.length} characters` : "Nothing saved yet"}</p>
          <Button onClick={save} disabled={saving || !dirty} size="sm">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save CV
          </Button>
        </div>
      </div>
    </div>
  );
}
