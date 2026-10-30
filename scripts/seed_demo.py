"""Load a demo notebook so every view has something to show — or take it back out.

~30 notes spread over the last ~4 months: campaign field visits where the same villages, people and
issues come back (so patterns form), promises that are now weeks old (so they go stale), campaign
strategy and media notes, general ideas, and everyday personal notes. Each note runs through the real
save-time pipeline (pipeline/ingest.py), so it takes a few minutes with a local LLM.

Demo notes are marked source='demo'; --remove deletes exactly those and leaves your own notes alone.

Run:  python3 scripts/seed_demo.py [email]           (default: APP_USER_EMAIL)
      python3 scripts/seed_demo.py --remove [email]
"""
import sys
from pathlib import Path
# Let `python scripts/x.py` import routes/core/db as top-level packages.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asyncio
import time
from sqlalchemy import text
from db.session import Session, engine
from core.config import settings
from pipeline import entities
from pipeline.ingest import ingest

# (days ago, what was said). Oldest first, so later notes can reuse the people/places/topics earlier ones set up.
NOTES = [
    (118, "Kot Khalsa chaupal meeting. Jaswant Kaur said the drainage near the gurdwara overflows every rain and "
          "children can't get to school. I told her I'd take the drainage up before the session. Sarpanch Balbir "
          "says the school roof has been leaking since monsoon."),
    (112, "Old Mandi visit with the traders' association. Rakesh Bansal says drug peddlers are openly active near "
          "the bus stand and the police is not acting. I promised Rakesh Bansal I'd talk to the SSP this week."),
    (104, "Idea for the campaign: a WhatsApp number where people can send a voice note about any problem in their "
          "village. We log it, reply within 48 hours, and show a public tracker of what got fixed."),
    (97, "Kheri Belt: canal water doesn't reach the tail end, paddy is drying. Baba Jaswant from the gurdwara "
         "committee raised it. Spoke to XEN Irrigation on phone, he said he'll visit. Doaba Khabar reporter was there."),
    (92, "Booth workers meeting at the party office. Gurnam Singh says the rival party is distributing money in "
         "Kheri Kalan and Bhaini Ratta. Booth workers want more pamphlets and two more vehicles for the last week."),
    (88, "Paid 18,500 for the pamphlet printing at Sharma Printers. Another 6,000 due on delivery."),
    (84, "Kheri Kalan with Master Harbhajan. Old age pensions not credited for three months, four elderly people "
         "came to complain. I promised Master Harbhajan I'd get the pension list checked at the DSWO office."),
    (79, "Sarkarpur City: street lights on the Guru Nanak Nagar road have been off for a month. Municipal committee "
         "says there's no budget. Youth asked about jobs and a sports ground."),
    (73, "Buy groceries: atta, dal, mustard oil, tea, and medicines for Biji. Pick up the dry cleaning on the way."),
    (70, "Feeling stretched thin. Too many village visits in one day, I can't remember half of what people said by "
         "evening. Need a better way to keep track or I'll keep letting people down."),
    (66, "Dhab Wala: BDPO has not released funds for the drainage, work stopped half way. Sarpanch of Dhab Wala "
         "says the contractor left. I promised to raise it with the BDPO on Monday."),
    (61, "Doaba Khabar wants an interview about the drug problem. Talking points: de-addiction centre in every "
         "block, more police patrols near bus stands, sports grounds for youth."),
    (57, "Kot Khalsa again. Jaswant Kaur asked about the drainage, still nothing done. Three more families "
         "complained about water entering their homes. Sarpanch Balbir says the school roof is still leaking."),
    (52, "Idea: monthly open house at the party office, first Sunday of every month, anyone can walk in with a "
         "problem. Publish what was raised and what got done."),
    (48, "Ghanta Ghar market: shopkeepers say drugs are being sold openly near the Anaj Mandi. Rakesh Bansal joined "
         "again and asked if I had spoken to the SSP. Police patrol was promised by the SSP office but hasn't started."),
    (44, "Nahar villages tour with booth workers. Water for paddy is short, Irrigation department not releasing "
         "canal water. Rattangarh farmers also complained about broken roads."),
    (39, "Dentist appointment for Simran on Thursday at 5. Remember to carry the old X-ray."),
    (35, "Rally planning for Sarkarpur City: need permission from the SDM, stage and sound by Tuesday, 300 chairs. "
         "Doaba Khabar and two YouTube channels to be invited."),
    (31, "Bhaini Ratta and Kotli Kalan: youth want jobs, many say the rival party is promising government jobs. "
         "Land records not updated for two years, Revenue department is slow."),
    (27, "Station Road and Railway Colony: health centre has no doctor for two weeks, people go to Ludhiana. "
         "I promised to write to the health department about posting a doctor."),
    (22, "Read about how Kerala runs its panchayat grievance system. Could we do a district-level version where "
         "every complaint gets a number and a deadline?"),
    (18, "Kheri Belt follow-up: XEN Irrigation never came. Baba Jaswant says the tail-end farmers have lost half the "
         "crop. Need to escalate to the Chief Engineer."),
    (14, "Rakesh Bansal called. Two boys from Old Mandi overdosed last week. Traders want a meeting with the SSP "
         "and the de-addiction centre doctor together."),
    (10, "Mom's birthday on the 22nd. Order the cake from Bakers Inn and book a table for eight at Haveli."),
    (8, "Dhab Wala sarpanch called again, drainage work still stuck, rain water standing in the main street. BDPO "
        "not picking up the phone."),
    (6, "Campaign idea: short weekly video, two minutes, 'what we fixed this week' with the people who raised it. "
        "Post on Facebook and WhatsApp groups every Sunday."),
    (4, "Kheri Kalan: four more people say pensions still not credited. Master Harbhajan asked whether I checked "
        "the list at the DSWO office."),
    (3, "Paid 4,200 for diesel for the campaign vehicles this week."),
    (2, "Rattangarh: drainage blocked near the school, Harpal Singh and two shopkeepers complained. Road to Kheri "
        "Khurd is also broken."),
    (1, "Met the SSP finally. He agreed to night patrols near the Old Mandi bus stand from Monday. Need to tell "
        "Rakesh Bansal and the traders' association."),
    (2, "Assembly session starts on 20 October. Need the drainage and pension questions ready a week before. "
        "Ask Master Harbhajan for the pension list from Kheri Kalan."),
    (1, "DSWO office meeting fixed for Friday at 11 about the pending old age pensions. Take the list of names."),
    (0, "Rakesh Bansal wants the traders' meeting with the SSP and the de-addiction doctor on Saturday at 4 at the "
        "Old Mandi dharamshala."),
]

async def _user(email: str) -> str:
    async with Session() as s:
        uid = (await s.execute(text("SELECT id FROM users WHERE email=:e"), {"e": email.strip().lower()})).scalar()
    if not uid:
        sys.exit(f"no user {email!r} — log in once (or set APP_USER_EMAIL) first")
    return str(uid)

async def remove(email: str) -> None:
    uid = await _user(email)
    async with Session() as s:
        n = (await s.execute(text("DELETE FROM notes WHERE user_id=:u AND source='demo' RETURNING id"), {"u": uid})).all()
        await entities.recount(s, uid)  # names only the demo notes mentioned go too
        await s.commit()
    print(f"removed {len(n)} demo notes")

async def seed(email: str) -> None:
    uid = await _user(email)
    async with Session() as s:  # already-loaded demo notes are skipped, so new ones can be added later
        have = set((await s.execute(text("SELECT raw_text FROM notes WHERE user_id=:u AND source='demo'"), {"u": uid})).scalars())
    todo = [(d, r) for d, r in NOTES if r not in have]
    if not todo:
        sys.exit("all demo notes are already loaded — run with --remove first to reload them")
    t0 = time.time()
    for i, (days, raw) in enumerate(todo, 1):
        t = time.time()
        async with Session() as s:
            nid = (await s.execute(text(
                "INSERT INTO notes (user_id, raw_text, source, enrich_state, created_at, updated_at) "
                "VALUES (:u, :t, 'demo', 'pending', now() - make_interval(days => :d), now() - make_interval(days => :d)) "
                "RETURNING id"), {"u": uid, "t": raw, "d": days})).scalar()
            await s.commit()
        await ingest(uid, str(nid))  # the same pipeline as a real save
        print(f"{i:>2}/{len(todo)}  {time.time() - t:4.1f}s  {raw[:60]}…", flush=True)
    await engine.dispose()
    print(f"done — {len(todo)} demo notes in {time.time() - t0:.0f}s")

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--remove"]
    email = args[0] if args else settings.app_user_email
    asyncio.run(remove(email) if "--remove" in sys.argv else seed(email))
