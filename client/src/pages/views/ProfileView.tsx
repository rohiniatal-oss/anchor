import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export function ProfileView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cvText, setCvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/profile/upload-cv", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) {
        toast({ title: "Upload failed", description: data.error || "Try a different file." });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setDirty(false);
      toast({ title: "CV uploaded", description: `Extracted ${data.extractedLength?.toLocaleString()} characters.` });
    } catch {
      toast({ title: "Upload failed", description: "Try again in a moment." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function extractTracks() {
    setExtracting(true);
    try {
      const r = await apiRequest("POST", "/api/profile/extract-tracks");
      const data = await r.json();
      if (!r.ok) {
        toast({ title: "Couldn't analyse CV", description: data.error || "Try again." });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/career-tracks"] });
      if (data.created?.length > 0) {
        toast({
          title: `Found ${data.created.length} career direction${data.created.length > 1 ? "s" : ""}`,
          description: data.created.map((t: any) => t.name).join(", "),
        });
      } else {
        toast({ title: data.message || "No new tracks to add." });
      }
    } catch {
      toast({ title: "Couldn't analyse CV", description: "Try again in a moment." });
    } finally {
      setExtracting(false);
    }
  }

  const hasCv = cvText.trim().length > 50;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-0.5">Profile</h2>
        <p className="text-sm text-muted-foreground">Upload your CV and we'll use it to suggest career directions, tailor applications, and personalise your plan.</p>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Your CV</p>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" onChange={handleFileUpload} className="hidden" />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                Upload file
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Upload a PDF, DOCX, or TXT file — or paste your CV text directly.</p>
          <textarea
            value={cvText}
            onChange={(e) => { setCvText(e.target.value); setDirty(true); }}
            placeholder="Paste your CV here, or use the upload button above…"
            className="w-full min-h-[360px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y font-mono text-xs leading-relaxed"
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{cvText.length > 0 ? `${cvText.length.toLocaleString()} characters` : "Nothing saved yet"}</p>
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving || !dirty} size="sm">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save CV
            </Button>
          </div>
        </div>
      </div>

      {hasCv && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Discover career directions from your CV</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                We'll read your experience and suggest 2-4 career tracks you could realistically pursue — based on what you've actually done, not generic advice.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={extractTracks} disabled={extracting} size="sm" variant="outline">
              {extracting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {extracting ? "Analysing…" : "Find my directions"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
