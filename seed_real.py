#!/usr/bin/env python3
"""Reseed Anchor with REAL, VERIFIED data (June 2026). Direct sqlite writes.
Sources: Rohini's inbox, live job boards, verified fellowship research. Nothing invented.
All roles start 'wishlist'. Two dated application tasks live in Today; networking in inbox."""
import sqlite3, time, os
DB = os.path.join(os.path.dirname(__file__), "data.db")
now = int(time.time() * 1000)
c = sqlite3.connect(DB)
for t in ("tasks", "jobs", "learn", "hustles", "events", "wins"):
    c.execute(f"DELETE FROM {t}")

# (title, company, location, url, note, next_step, status, deadline, flag)
jobs = [
    ("Director of Operations (Expression of Interest)", "GovAI (Centre for the Governance of AI)", "Global / Remote",
     "https://www.governance.ai/post/doo-eoi-2026",
     "Strongest fit \u2014 senior ops/chief-of-staff at a top AI-governance org. Rolling EOI, accepts global applicants.",
     "Open the job spec and note 3 things they ask for", "wishlist", "", "Top fit"),
    ("People Operations Manager", "GovAI (Centre for the Governance of AI)", "London or Washington DC (global ok)",
     "https://www.governance.ai/post/people-operations-manager-2",
     "A real near-term deadline.", "", "wishlist", "2026-06-21", ""),
    ("Expression of Interest \u2014 Governance Researcher", "Apollo Research", "London, UK",
     "https://jobs.lever.co/apolloresearch/c7377abe-39ac-4712-8d2f-b048f363480a",
     "London-based, rolling. AI governance research, policy-facing. Mid-level (5-9 yrs).", "", "wishlist", "", "London"),
    ("AI Policy Leaders Programme", "Talos Network", "Brussels + paid placement",
     "https://www.talosnetwork.org/policy-leaders-programme",
     "12-month PAID placement (\u20ac5k/mo) + bootcamp.", "", "wishlist", "", "EU citizenship"),
    ("Postdoctoral Researcher, AI & Geopolitics", "Oxford Martin School", "Oxford, UK",
     "https://my.corehr.com/pls/uoxrecruit/erq_jobspec_version_4.display_form?p_recruitment_id=186510",
     "Requires a PhD, so likely a stretch vs your practitioner background. Listed for completeness.", "", "wishlist", "2026-06-05", "PhD needed"),
    ("Frontier AI Research Lead", "CSET (Georgetown)", "Washington DC (hybrid)",
     "https://cset.georgetown.edu/job/research-or-senior-fellow-frontier-ai/",
     "Rolling. Senior AI-governance research leadership.", "", "wishlist", "", "US visa"),
    ("Senior Research Lead \u2014 AI Security Portfolio", "RAND Corporation (CAST)", "USA incl. Remote",
     "https://rand.wd5.myworkdayjobs.com/en-US/External_Career_Site/details/Senior-Research-Lead---AI-Security-Portfolio_R3464-1",
     "Strong fit for supply-chain security + strategy. Fixed-term.", "", "wishlist", "", "US visa"),
    ("Browse the 80,000 Hours job board (832 live roles)", "80,000 Hours", "Global / Remote",
     "https://jobs.80000hours.org/",
     "Your best ongoing source \u2014 832 open roles, ~70 new each week. Filter for AI governance, policy, strategy, ops.",
     "Open the board and shortlist 3 roles that fit", "wishlist", "", "Ongoing"),
]
for j in jobs:
    c.execute("INSERT INTO jobs(title,company,location,url,note,next_step,status,deadline,flag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (*j, now))

learn = [
    ("Impact Accelerator Program (free, 6-week)", "Fellowship \u00b7 OPEN", "https://www.highimpactprofessionals.org/impact-accelerator",
     "From your inbox \u2014 BlueDot referred you. DEADLINE SUN 7 JUN. Free, mid-career, AI-safety focus. Program 13 Jul-23 Aug.", 0, 1),
    ("BlueDot AGI Strategy course (prerequisite)", "AI Governance \u00b7 OPEN", "https://bluedot.org/courses/agi-strategy",
     "Free. Next deadline ~7 Jun, rolling after. HARD prerequisite for the AI Governance course. You have an application in progress \u2014 finish it.", 0, 1),
    ("BlueDot AI Governance course", "AI Governance \u00b7 OPEN", "https://bluedot.org/courses/ai-governance",
     "Free. Next cohorts 14 Jun & 5 Jul. Needs AGI Strategy first (genuinely required).", 0, 0),
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
     "The forecasting craft, from credibility not theory. ~\u00a312.", 0, 0),
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
for l in learn:
    c.execute("INSERT INTO learn(title,category,url,note,done,active,created_at) VALUES(?,?,?,?,?,?,?)", (*l, now))

hustles = [
    ("Substack \u2014 geopolitical consequence analysis", "\u201cIf this, then what\u201d second-order consequence writing. Geopolitics-focused (not AI). Brand new \u2014 no presence yet.", "Decide your angle: what would you write about?", "idea"),
    ("Afterline", "Event / consequence-prediction app \u2014 the engine behind the Substack. NOT parked.", "Sketch the next core screen", "testing"),
]
for h in hustles:
    c.execute("INSERT INTO hustles(title,note,next_step,stage,created_at) VALUES(?,?,?,?,?)", (*h, now))

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
for who, sector, why, status in contacts:
    c.execute("INSERT INTO contacts(name,who,sector,why,status,note,created_at) VALUES('',?,?,?,?,'',?)", (who, sector, why, status, now))

c.commit()
c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
print("REAL seed: %d jobs, %d learn (2 active), %d hustles, 2 dated today-tasks, %d contacts" % (len(jobs), len(learn), len(hustles), len(contacts)))
c.close()
