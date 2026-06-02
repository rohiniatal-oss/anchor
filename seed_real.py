#!/usr/bin/env python3
"""Reseed Anchor with REAL, VERIFIED data (June 2026). Direct sqlite writes.
Sources: Rohini's inbox, live job boards, verified fellowship research. Nothing invented.
All roles start 'wishlist'. Two dated application tasks live in Today; networking in inbox."""
import sqlite3, time, os
DB = os.path.join(os.path.dirname(__file__), "data.db")
now = int(time.time() * 1000)
c = sqlite3.connect(DB)
for t in ("tasks", "jobs", "learn", "hustles", "events", "wins", "career_tracks"):
    try: c.execute(f"DELETE FROM {t}")
    except Exception: pass

# ── CAREER TRACKS ── the strategic spine. Everything links to one of these.
# (slug, name, description, target_role_archetype, priority, status, why_it_fits)
tracks = [
    ("ai-gov-ops", "AI Governance — Ops & Chief of Staff",
     "Senior operations / chief-of-staff roles inside top AI-governance orgs.", "chief_of_staff", 100, "active",
     "Your Bain delivery + TBI advisory background maps directly onto running a mission-driven org."),
    ("ai-gov-research", "AI Governance — Policy & Research",
     "Policy-facing research roles on frontier AI and governance.", "research", 70, "active",
     "Supply-chain security + strategy analysis is a credible bridge into governance research."),
    ("geo-advisory", "Geopolitical Advisory",
     "Geopolitical risk and strategy advisory to leadership.", "advisory", 80, "active",
     "Direct continuation of your GCC government advisory at TBI."),
    ("strategy-ops", "Strategy & Operations (general)",
     "Strategy / ops / chief-of-staff outside the AI-gov niche.", "strategy_ops", 60, "active",
     "Your consulting + product delivery record is a broad, safe fallback lane."),
    ("gcc-advisory", "GCC / Government Advisory",
     "Government and sovereign advisory in the Gulf.", "advisory", 50, "watch",
     "Existing GCC relationships and regional credibility."),
    ("thought-leadership", "Thought Leadership & Proof",
     "Public credibility: writing, forecasting, the Substack and Afterline.", "", 65, "active",
     "Proof assets that make every application and outreach more credible."),
]
track_id = {}
for t in tracks:
    cur = c.execute("""INSERT INTO career_tracks(slug,name,description,target_role_archetype,priority,status,why_it_fits,created_at)
                       VALUES(?,?,?,?,?,?,?,?)""", (*t, now))
    track_id[t[0]] = cur.lastrowid

# (title, company, location, url, note, next_step, status, deadline, flag,
#  role_archetype, fit_score, eligibility_risk, application_readiness, source_url)
jobs = [
    ("Director of Operations (Expression of Interest)", "GovAI (Centre for the Governance of AI)", "Global / Remote",
     "https://www.governance.ai/post/doo-eoi-2026",
     "Strongest fit \u2014 senior ops/chief-of-staff at a top AI-governance org. Rolling EOI, accepts global applicants.",
     "Open the job spec and note 3 things they ask for", "wishlist", "", "Top fit",
     "chief_of_staff", 92, "", "none"),
    ("People Operations Manager", "GovAI (Centre for the Governance of AI)", "London or Washington DC (global ok)",
     "https://www.governance.ai/post/people-operations-manager-2",
     "A real near-term deadline.", "", "wishlist", "2026-06-21", "",
     "ops", 80, "", "none"),
    ("Expression of Interest \u2014 Governance Researcher", "Apollo Research", "London, UK",
     "https://jobs.lever.co/apolloresearch/c7377abe-39ac-4712-8d2f-b048f363480a",
     "London-based, rolling. AI governance research, policy-facing. Mid-level (5-9 yrs).", "", "wishlist", "", "London",
     "research", 74, "", "none"),
    ("AI Policy Leaders Programme", "Talos Network", "Brussels + paid placement",
     "https://www.talosnetwork.org/policy-leaders-programme",
     "12-month PAID placement (\u20ac5k/mo) + bootcamp.", "", "wishlist", "", "EU citizenship",
     "policy", 55, "citizenship", "none"),
    ("Postdoctoral Researcher, AI & Geopolitics", "Oxford Martin School", "Oxford, UK",
     "https://my.corehr.com/pls/uoxrecruit/erq_jobspec_version_4.display_form?p_recruitment_id=186510",
     "Requires a PhD, so likely a stretch vs your practitioner background. Listed for completeness.", "", "wishlist", "2026-06-05", "PhD needed",
     "research", 30, "likely_ineligible", "none"),
    ("Frontier AI Research Lead", "CSET (Georgetown)", "Washington DC (hybrid)",
     "https://cset.georgetown.edu/job/research-or-senior-fellow-frontier-ai/",
     "Rolling. Senior AI-governance research leadership.", "", "wishlist", "", "US visa",
     "research", 60, "visa", "none"),
    ("Senior Research Lead \u2014 AI Security Portfolio", "RAND Corporation (CAST)", "USA incl. Remote",
     "https://rand.wd5.myworkdayjobs.com/en-US/External_Career_Site/details/Senior-Research-Lead---AI-Security-Portfolio_R3464-1",
     "Strong fit for supply-chain security + strategy. Fixed-term.", "", "wishlist", "", "US visa",
     "research", 70, "visa", "none"),
    ("Browse the 80,000 Hours job board (832 live roles)", "80,000 Hours", "Global / Remote",
     "https://jobs.80000hours.org/",
     "Your best ongoing source \u2014 832 open roles, ~70 new each week. Filter for AI governance, policy, strategy, ops.",
     "Open the board and shortlist 3 roles that fit", "wishlist", "", "Ongoing",
     "", 50, "", "none"),
]
# Map each job (by index) to its career track.
job_tracks = ["ai-gov-ops", "ai-gov-ops", "ai-gov-research", "ai-gov-research",
              "ai-gov-research", "ai-gov-research", "ai-gov-research", "ai-gov-ops"]
for idx, j in enumerate(jobs):
    rtid = track_id.get(job_tracks[idx] if idx < len(job_tracks) else "", None)
    c.execute("""INSERT INTO jobs(title,company,location,url,note,next_step,status,deadline,flag,
                 role_archetype,fit_score,eligibility_risk,application_readiness,source_url,related_track_id,created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (*j, j[3], rtid, now))

# (title, category, url, note, done, active, type, learn_status, application_deadline, required_output)
learn = [
    ("Impact Accelerator Program (free, 6-week)", "Fellowship \u00b7 OPEN", "https://www.highimpactprofessionals.org/impact-accelerator",
     "From your inbox \u2014 BlueDot referred you. DEADLINE SUN 7 JUN. Free, mid-career, AI-safety focus. Program 13 Jul-23 Aug.", 0, 1,
     "fellowship", "open", "2026-06-07", "Submitted application"),
    ("BlueDot AGI Strategy course (prerequisite)", "AI Governance \u00b7 OPEN", "https://bluedot.org/courses/agi-strategy",
     "Free. Next deadline ~7 Jun, rolling after. HARD prerequisite for the AI Governance course. You have an application in progress \u2014 finish it.", 0, 1,
     "course", "open", "2026-06-07", "Confirm deadline + finish application"),
    ("BlueDot AI Governance course", "AI Governance \u00b7 OPEN", "https://bluedot.org/courses/ai-governance",
     "Free. Next cohorts 14 Jun & 5 Jul. Needs AGI Strategy first (genuinely required).", 0, 0,
     "course", "watch", "", "Course completion"),
    ("Astra Fellowship \u2014 Strategy & Governance", "Fellowship \u00b7 WATCH", "https://constellation.org/programs/astra/strategy",
     "You were invited (13 May) but the cohort CLOSED 3 May \u2014 EOI open for next. Fully in-person Berkeley (5 mo); only rare remote / UK hub at LISA.", 0, 0),
    ("GovAI Seasonal Fellowship (London \u00a312k / DC $21k)", "Fellowship \u00b7 WATCH", "https://www.governance.ai/opportunities",
     "Summer 2026 closed. Winter 2027 deadline expected ~Jul 2026 \u2014 set a reminder.", 0, 0),
    ("ERA:AI Cambridge Fellowship (fully funded)", "Fellowship \u00b7 WATCH", "https://erafellowship.org/fellowship",
     "Summer 2026 closed. UK-based, funded + housing. Watch for next window.", 0, 0),
    ("Pivotal Research Fellowship (paid)", "Fellowship \u00b7 WATCH", "https://www.pivotal-research.org/fellowship",
     "Q3 closed (was 3 May). Watch for Q4 2026 / Q1 2027. \u00a36-8k + housing.", 0, 0),
    ("Talos Fellowship (EU AI policy)", "Fellowship \u00b7 WATCH", "https://www.talosnetwork.org/talos-fellowship",
     "Autumn 2026 closed. EU citizenship strongly preferred.", 0, 0),
    ("IAPS AI Policy Fellowship (fully funded)", "Fellowship \u00b7 WATCH", "https://www.iaps.ai/fellowship",
     "2026 closed (was 2 Feb). US work authorisation required.", 0, 0),
    ("Horizon Fellowship (US, $113k stipend)", "Fellowship \u00b7 WATCH", "https://horizonpublicservice.org/programs/become-a-fellow/",
     "2026 closed. Reopens ~Jul 2026. US work eligibility required.", 0, 0),
    ("Superforecasting \u2014 Tetlock & Gardner (book)", "Geopolitics craft", "https://www.goodjudgment.com/resources/the-superforecasters/",
     "The forecasting craft, from credibility not theory. ~\u00a312.", 0, 0,
     "book", "watch", "", "Log one forecast"),
    ("Good Judgment Open \u2014 practice forecasting (free)", "Geopolitics craft", "https://www.gjopen.com/",
     "Free. Make real predictions, build a track record.", 0, 0),
    ("Foreign Affairs \u2014 read one piece a day", "Geopolitics craft", "https://www.foreignaffairs.com/",
     "Partly free. A daily sharp read keeps the craft warm.", 0, 0),
    ("Presence \u2014 Amy Cuddy (+ free TED talk)", "Gravitas", "https://www.ted.com/talks/amy_cuddy_your_body_language_may_shape_who_you_are",
     "TED talk is free. On reading as senior / commanding a room.", 0, 0),
    ("Executive Presence \u2014 Sylvia Ann Hewlett (book)", "Gravitas", "",
     "On gravitas, communication and appearance \u2014 directly on your 'look younger' concern.", 0, 0),
    ("The Pyramid Principle \u2014 Barbara Minto (book)", "Consulting craft", "",
     "The structuring bible. Directly targets 'poor structuring' you flagged.", 0, 0),
    ("HBR IdeaCast (podcast, free)", "Leadership", "https://hbr.org/podcasts/ideacast",
     "Free. Bite-size leadership & management on a walk.", 0, 0),
]
# Pad any short rows (the WATCH/craft items) with sensible defaults for the new fields.
def _learn_row(l):
    base = list(l)
    while len(base) < 10:
        # type, learn_status, application_deadline, required_output
        defaults = ["resource", "watch", "", ""]
        base.append(defaults[len(base) - 6])
    return base
# Map each learn item (by index) to a track. AI-gov courses/fellowships -> ai-gov-research;
# forecasting/geopolitics craft -> geo-advisory; gravitas/consulting/leadership -> strategy-ops.
learn_tracks = [
    "ai-gov-research", "ai-gov-research", "ai-gov-research",  # Impact Accel, AGI Strategy, AI Gov
    "ai-gov-research", "ai-gov-research", "ai-gov-research",  # Astra, GovAI Seasonal, ERA
    "ai-gov-research", "ai-gov-research", "ai-gov-research", "ai-gov-research",  # Pivotal, Talos, IAPS, Horizon
    "geo-advisory", "geo-advisory", "geo-advisory",          # Superforecasting, GJ Open, Foreign Affairs
    "strategy-ops", "strategy-ops", "strategy-ops", "strategy-ops",  # Presence, Exec Presence, Pyramid, HBR
]
for idx, l in enumerate(learn):
    r = _learn_row(l)
    rtid = track_id.get(learn_tracks[idx] if idx < len(learn_tracks) else "", None)
    c.execute("""INSERT INTO learn(title,category,url,note,done,active,type,learn_status,application_deadline,required_output,related_track_id,created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""", (*r, rtid, now))

hustles = [
    ("Substack \u2014 geopolitical consequence analysis", "\u201cIf this, then what\u201d second-order consequence writing. Geopolitics-focused (not AI). Brand new \u2014 no presence yet.", "Decide your angle: what would you write about?", "idea"),
    ("Afterline", "Event / consequence-prediction app \u2014 the engine behind the Substack. NOT parked.", "Sketch the next core screen", "testing"),
]
for h in hustles:
    # Both proof assets serve the thought-leadership track.
    c.execute("INSERT INTO hustles(title,note,next_step,stage,proof_asset_for_track,created_at) VALUES(?,?,?,?,?,?)",
              (*h, track_id.get("thought-leadership"), now))

# TWO dated application tasks live in Today (real deadlines -> drive plan urgency + chips).
dated = [
    ("Apply to the Impact Accelerator (free, 6-week)", "job", "deep", "2026-06-07"),
    ("Finish your GovAI People Ops Manager application", "job", "deep", "2026-06-21"),
]
for title, cat, size, dl in dated:
    c.execute("""INSERT INTO tasks(title,list,block,done,sort,category,size,deadline,status,skipped,pinned,steps,done_when,created_at)
                 VALUES(?,?,?,0,0,?,?,?,?,0,0,'[]','',?)""", (title, "today", "morning", cat, size, dl, "not_started", now))

# A couple of brain-dump items (real, light) so the inbox isn't empty.
for title, cat in [("Register for the FT 'Securing semiconductor FDI' webinar (supply-chain)", "learning")]:
    c.execute("""INSERT INTO tasks(title,list,block,done,sort,category,size,deadline,status,skipped,pinned,steps,done_when,created_at)
                 VALUES(?,?,NULL,0,0,?,?,'','not_started',0,0,'[]','',?)""", (title, "inbox", cat, "quick", now))

# NETWORKING outreach pipeline (contacts table). Warm routes tied to her targets;
# 'who' is by type (no invented names) — she fills the name in-app.
contacts = [
    ("ex-Bain colleague now in AI policy or a think tank", "AI governance",
     "Warmest route into GovAI / Apollo — a Bain alum already inside the sector can refer or advise.", "to_contact"),
    ("ex-Tony Blair Institute contact in tech/AI policy", "AI policy",
     "TBI network overlaps heavily with AI-governance orgs — a direct line to live roles.", "to_contact"),
    ("someone in the BlueDot / AI-safety community (Slack)", "AI safety",
     "You're already in the BlueDot community — a low-friction first message unlocks the fellowship network.", "to_contact"),
]
contact_tracks = ["ai-gov-ops", "ai-gov-research", "ai-gov-research"]
for i, (who, sector, why, status) in enumerate(contacts):
    rtid = track_id.get(contact_tracks[i] if i < len(contact_tracks) else "", None)
    c.execute("INSERT INTO contacts(name,who,sector,why,status,note,related_track_id,created_at) VALUES('',?,?,?,?,'',?,?)",
              (who, sector, why, status, rtid, now))

c.commit()
c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
print("REAL seed: %d jobs, %d learn (2 active), %d hustles, 2 dated today-tasks, %d contacts" % (len(jobs), len(learn), len(hustles), len(contacts)))
c.close()
