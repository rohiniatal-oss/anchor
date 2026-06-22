import type { Express } from "express";
import multer from "multer";
import { storage } from "./storage";
import { llmJSON, MODEL_LIGHT } from "./llm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export function registerProfileRoutes(app: Express) {
  app.get("/api/profile", async (_req, res) => {
    const profile = await storage.getProfile();
    res.json(profile ?? { cvText: "", targetRoles: "", locationPreferences: "", searchPhase: "" });
  });

  app.patch("/api/profile", async (req, res) => {
    const patch = {
      ...(req.body?.cvText !== undefined ? { cvText: String(req.body.cvText ?? "") } : {}),
      ...(req.body?.targetRoles !== undefined ? { targetRoles: String(req.body.targetRoles ?? "").trim().slice(0, 800) } : {}),
      ...(req.body?.locationPreferences !== undefined ? { locationPreferences: String(req.body.locationPreferences ?? "").trim().slice(0, 500) } : {}),
      ...(req.body?.searchPhase !== undefined ? { searchPhase: String(req.body.searchPhase ?? "").trim().slice(0, 120) } : {}),
    };
    const profile = await storage.upsertProfile(patch);
    res.json(profile);
  });

  app.post("/api/profile/upload-cv", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      let text = "";
      const ext = (file.originalname || "").toLowerCase();

      if (ext.endsWith(".pdf")) {
        const { extractText } = await import("unpdf");
        const result = await extractText(new Uint8Array(file.buffer));
        text = Array.isArray(result.text) ? result.text.join("\n") : String(result.text || "");
      } else if (ext.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        text = result.value || "";
      } else if (ext.endsWith(".txt")) {
        text = file.buffer.toString("utf-8");
      } else {
        return res.status(400).json({ error: "Supported formats: PDF, DOCX, or TXT" });
      }

      text = text.trim();
      if (!text) return res.status(400).json({ error: "Couldn't extract any text from that file" });

      const profile = await storage.upsertProfile({ cvText: text });
      res.json({ profile, extractedLength: text.length });
    } catch (e: any) {
      console.error("CV upload error:", e);
      res.status(500).json({ error: "Failed to process file" });
    }
  });

  app.post("/api/profile/extract-tracks", async (_req, res) => {
    try {
      const profile = await storage.getProfile();
      const cvText = (profile?.cvText || "").trim();
      if (!cvText) return res.status(400).json({ error: "No CV text saved. Upload or paste your CV first." });

      const existingTracks = await storage.getCareerTracks();
      const existingNames = existingTracks.map((t) => t.name).join(", ");

      const prompt = `You are a career strategist. Read this CV and suggest 2-4 career tracks (directions the person could realistically pursue based on their experience).

CV TEXT:
${cvText.slice(0, 6000)}

${existingNames ? `EXISTING TRACKS (do not duplicate): ${existingNames}` : ""}

Return JSON array. Each element:
{
  "name": "Short track name, 2-4 words (e.g. 'Strategy Consulting', 'Tech Policy', 'Impact Investing')",
  "description": "One sentence on why this track fits their background",
  "targetRoleArchetype": "The type of role (e.g. 'strategy consultant', 'policy analyst', 'product manager')",
  "whyItFits": "Specific evidence from the CV — mention actual experience, skills, or roles"
}

Be specific to THIS person's actual background. No generic suggestions.`;

      const tracks = await llmJSON<Array<{
        name: string;
        description: string;
        targetRoleArchetype: string;
        whyItFits: string;
      }>>(prompt, { model: MODEL_LIGHT });

      if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        return res.status(500).json({ error: "Couldn't extract career directions from your CV. Try adding more detail." });
      }

      const created = [];
      for (const t of tracks.slice(0, 4)) {
        if (!t.name) continue;
        const existing = existingTracks.find((e) => e.name.toLowerCase() === t.name.toLowerCase());
        if (existing) continue;
        const track = await storage.createCareerTrack({
          name: t.name,
          slug: t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          description: t.description || "",
          targetRoleArchetype: t.targetRoleArchetype || "",
          whyItFits: t.whyItFits || "",
          priority: 0,
          status: "active",
        });
        created.push(track);
      }

      res.json({ created, message: created.length > 0
        ? `Found ${created.length} career direction${created.length > 1 ? "s" : ""} from your CV.`
        : "Your CV matches tracks you already have — no new ones to add." });
    } catch (e: any) {
      console.error("Track extraction error:", e);
      res.status(500).json({ error: "Failed to analyse CV" });
    }
  });
}
