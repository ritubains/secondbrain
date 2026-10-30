"""A spoken note written up for reading, in Markdown: what the writer has to do as a checklist ("- [ ]"), other lists as
bullets, separate parts under "## " headings, filler and format requests ("make me a checklist") dropped. One AI call of
its own, then checked by rule before it's kept — a small model sometimes adds an item, changes a time or drops a
name, and a tidy note that says something different from what was said is worse than the note as written:
  · no number that wasn't said, and every time and date said kept (a count like "around 10 tasks" may go)
  · every name from the note kept
  · every line made of the note's own words (headings aside), so nothing is invented
  · not much longer than what was said

layout()     → the write-up, or "" (short note, no AI, or it didn't pass the checks)
formatted()  whether text already has its own headings, lists or checklists (then it's left as it is)
asks_format()  whether the note asks to be a checklist or list (then it's written up however short)
"""
import re
import prompts
from core.llm import Unavailable, chat

SHORT = 80   # a note shorter than this reads fine as written
LONG_TYPED = 200  # a typed note is written up only from this long (and only when it has no formatting of its own)
STRUCTURE = re.compile(r"^\s*(#{1,3}\s|[-*•]\s|\d+[.)]\s)", re.M)
OWN_WORDS = 0.6  # a line of the write-up must be at least this much words from the note
STOP = set("a an the and or to of in on at for with by from is are was were be been am i my me we our you your it this that "
           "then also so will would should have has had do did not no".split())
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
                "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "fifty": 50, "hundred": 100}

async def layout(body: str, names: list) -> str:
    """The note laid out for reading, if it's long enough to need it and the result keeps every number and name."""
    if len(body) < SHORT:
        return ""
    try:
        out = await chat([{"role": "user", "content": prompts.LAYOUT.format(text=body[:6000])}], temperature=0)
    except Unavailable:
        return ""
    text = _tidy(out)
    return text if text and _faithful(body, text, names) else ""

ASKS_FORMAT = re.compile(r"\b(check ?list|to-?do(?: list)?|todo|make (?:a |me a )?list|bullet ?points?|in points)\b", re.I)

def asks_format(text: str) -> bool:
    """Whether the note asks to be a checklist or list ("make a to-do list", "checklist: …")."""
    return bool(ASKS_FORMAT.search(text))

def formatted(text: str) -> bool:
    """Whether the text already has headings, lists or checklists of its own."""
    return bool(STRUCTURE.search(text))

def _tidy(out: str) -> str:
    """One bullet style, checklist boxes the editor reads ("- [ ]"), no code fences or quotes, no runs of blank lines."""
    out = re.sub(r"^```\w*|```$", "", out.strip()).strip().strip('"')
    lines = [re.sub(r"^\s*[*•·]\s+", "- ", line.rstrip()) for line in out.replace("\r", "").split("\n")]
    lines = [re.sub(r"^(\s*)-\s*\*\*\[( |x)\]\s*(.*?)\*\*$", r"\1- [\2] \3", line) for line in lines]  # "- **[ ] x**"
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()[:4000]

def _numbers(t: str) -> list:
    """Every number in a text, written as digits or words ("nine meetings" → 9), in order."""
    return [int(w) if w.isdigit() else NUMBER_WORDS[w] for w in re.findall(r"\d+|[a-z]+", t.lower()) if w.isdigit() or w in NUMBER_WORDS]

WHEN = re.compile(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
                  r"tomorrow|today|tonight|january|february|march|april|may|june|july|august|september|october|november|december)\b", re.I)

def _when(t: str) -> list:
    """The times and days a text names ("8pm", "11:30", "Monday", "tomorrow"), squashed for comparing."""
    return [re.sub(r"\s+|\.", "", m.group(0).lower()) for m in WHEN.finditer(t)]

def _faithful(body: str, text: str, names: list) -> bool:
    """Kept only if it passes every check in the module docstring."""
    low, said, kept = text.lower(), set(_numbers(body)), set(_numbers(text))
    squashed = re.sub(r"\s+|\.", "", low)
    if kept - said or not all(w in squashed for w in _when(body)):
        return False
    if not all(n.lower() in low for n in names) or len(text) > 1.25 * len(body) + 80:
        return False
    stems = {w[:5] for w in re.findall(r"[a-z0-9]+", body.lower())}
    for line in text.split("\n"):
        if line.lstrip().startswith("#"):
            continue  # a heading may sum up in its own words
        words = [w for w in re.findall(r"[a-z0-9]+", line.lower()) if w not in STOP and w not in ("x",)]
        if words and sum(w[:5] in stems for w in words) < OWN_WORDS * len(words):
            return False
    return True
