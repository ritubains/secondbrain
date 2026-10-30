"""Dates from words: "Thursday at 5", "the 22nd", "tomorrow evening" → a real date, counted from the day the note
was written. The AI quotes the words; the arithmetic lives here (small models get weekdays wrong). No day in the
words → None, and the event is left out rather than guessed."""
import re
from datetime import date, datetime, time, timedelta
from typing import Optional, Tuple

DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]
_MON = {m[:3]: i + 1 for i, m in enumerate(MONTHS)}

def _month(tok: str) -> Optional[int]:
    return _MON.get(tok[:3].lower()) if tok and tok[:3].lower() in _MON else None

def _next_dom(base: date, day: int) -> Optional[date]:
    # The next "22nd" on or after base (this month if not past, else next month).
    for add in range(0, 3):
        y, m = base.year + (base.month - 1 + add) // 12, (base.month - 1 + add) % 12 + 1
        try:
            d = date(y, m, day)
        except ValueError:
            continue
        if d >= base:
            return d
    return None

def parse_day(said: str, written: date) -> Optional[date]:
    s = " ".join((said or "").lower().replace(",", " ").split())
    if not s:
        return None
    if m := re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", s):
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    if re.search(r"\btoday\b|\btonight\b|\bthis evening\b", s):
        return written
    if re.search(r"\bday after tomorrow\b", s):  # before "tomorrow", which it contains
        return written + timedelta(days=2)
    if re.search(r"\btomorrow\b", s):
        return written + timedelta(days=1)
    # "20 October", "October 20", "20th Oct"
    if m := re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b", s):
        mo = _month(m[2])
        if mo:
            return _year_ahead(written, mo, int(m[1]))
    if m := re.search(r"\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b", s):
        mo = _month(m[1])
        if mo:
            return _year_ahead(written, mo, int(m[2]))
    # "the 22nd", "on 22nd"
    if m := re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\b", s):
        return _next_dom(written, int(m[1]))
    # weekdays: "Thursday", "next Monday", "from Monday"
    for i, d in enumerate(DAYS):
        if re.search(rf"\b{d}\b|\b{d[:3]}\b", s):
            ahead = (i - written.weekday()) % 7 or 7  # the coming one, never the day it was written
            return written + timedelta(days=ahead)
    if re.search(r"\bnext week\b", s):
        return written + timedelta(days=7 - written.weekday())  # its Monday
    return None

def _year_ahead(written: date, month: int, day: int) -> Optional[date]:
    # A day-month with no year: this year, unless that's well before the note (then next year).
    try:
        d = date(written.year, month, day)
    except ValueError:
        return None
    return d if d >= written - timedelta(days=7) else date(written.year + 1, month, day)

def parse_time(said: str) -> Optional[time]:
    # "at 5" / "5 pm" / "17:30"; a bare 1–7 means afternoon (nobody books 5am).
    s = (said or "").lower()
    if m := re.search(r"\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b", s):
        h, mi = int(m[1]), int(m[2])
    elif m := re.search(r"\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b", s) or re.search(r"\bat\s+(\d{1,2})\b", s):
        h, mi = int(m[1]), 0
    else:
        return None
    ap = m.group(m.lastindex) if m.lastindex and m.group(m.lastindex) in ("am", "pm") else ""
    if ap == "pm" and h < 12:
        h += 12
    elif not ap and 1 <= h <= 7:
        h += 12
    return time(h, mi) if 0 <= h < 24 and 0 <= mi < 60 else None

# "morning" / "afternoon" / "evening" / "night": roughly when, for ordering — not a time anyone said.
_PARTS = (("morning", 9), ("noon", 12), ("after lunch", 14), ("afternoon", 14), ("evening", 18), ("tonight", 20), ("night", 20))

def part_of_day(said: str) -> Optional[time]:
    s = (said or "").lower()
    for w, h in _PARTS:
        if re.search(rf"\b{w}\b", s) and not (w == "noon" and "afternoon" in s):
            return time(h, 0)
    return None

def resolve(said: str, written: datetime) -> Tuple[Optional[date], Optional[time]]:
    d = parse_day(said, written.date())
    return (d, parse_time(said)) if d else (None, None)

def due(said: str, written: datetime) -> Tuple[Optional[datetime], bool]:
    """When an event happens → (local datetime or None, whether a time was actually said). A part of the day
    ("afternoon") sets a rough time for ordering; no time at all → 9 in the morning."""
    d, t = resolve(said, written)
    if not d:
        return None, False
    return datetime.combine(d, t or part_of_day(said) or time(9, 0)).astimezone(), t is not None

# "this week", "last month", "past 10 days" → how many days back a question looks.
_WINDOWS = (("today", 1), ("yesterday", 2), ("this week", 7), ("last week", 14), ("past week", 7), ("this month", 31),
            ("last month", 62), ("past month", 31), ("lately", 31), ("recently", 31), ("this year", 366))

def window(question: str) -> Optional[int]:
    """Days back a question asks about, or None when it names no time span."""
    q = question.lower()
    if m := re.search(r"\b(?:last|past)\s+(\d{1,3})\s+days?\b", q):
        return int(m.group(1))
    return next((days for words, days in _WINDOWS if words in q), None)

# Trends compare the last RECENT days with the BEFORE days before them.
RECENT, BEFORE = 30, 60

def trend(recent: int, before: int) -> str:
    """growing: more lately than the usual rate · new: nothing before · quiet: nothing lately · steady otherwise."""
    if not recent:
        return "quiet" if before else ""
    if not before:
        return "new"
    return "growing" if recent > before / 2 + 0.5 else "steady"
