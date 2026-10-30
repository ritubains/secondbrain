"""Every prompt the app sends, in one place. Kept short: say what's wanted, show the shape, trust the model."""

# pipeline/extract.py — one call per note, typed or spoken.
EXTRACT = """Read this note and return JSON describing it. It may be typed or spoken; spoken notes ramble, so ignore greetings and filler.

{{
  "title": "a short title",
  "summary": "one or two plain sentences",
  "kind_of_note": "what kind of note this is, in 1-3 words, without its subject",
  "tags": ["2-5 lowercase keywords"],
  "issues": ["the matters the note is about, each a short plain noun of 1-2 words"],
  "entities": [{{"name": "as written", "kind": "person | place | official | group | term", "meaning": "", "also": []}}],
  "main_place": "the place the note is mostly about, or empty",
  "items": [{{"kind": "promise | issue | event | task", "text": "short", "who": [], "topic": "", "when": ""}}],
  "relations": [{{"subject": "a person, place, office or group", "relation": "short phrase", "object": "another one, or a value"}}]
}}

entities: every person, place, office, group and term mentioned. person: a named individual, with any title they go by. place: a village, town, area or road, by its name alone. official: a post or office. group: a party, association, committee or crowd. term: an abbreviation or local word, with its meaning. Put other spellings in "also" only if the note suggests them.
items: an event is anything tied to a day or time, even a visit or something to do; put the words that say when in "when". A promise is something the writer committed to someone (who: to whom). An issue is a problem or request others raised (who: raised by; topic: its subject in 1-2 words). A task is something the writer must do, with no day.
relations: lasting facts that link the people, places, offices and groups in the note: someone's role or post and where, who someone works for, where someone lives, which office handles what. Only facts the note states.
issues: name each matter as a plain noun, the way the same matter would be named in any other note about it; never a person, a place or the kind of note.
kind_of_note: only the kind of note it is, never what it is about.
{known}Written on {written}.

Note:
\"\"\"{text}\"\"\""""

# pipeline/layout.py — the note laid out for reading (a separate, small call; checked before it's kept).
LAYOUT = """Rewrite this note as a tidy note in Markdown. Use only what the note says, in its own words; say each
thing once. Leave out filler, greetings and anything said to you about how to format it.
Things the writer still has to do become a checklist ("- [ ] "); what already happened is never a checklist item.
Other lists become bullets ("- "). Only when the note covers clearly separate parts, give each part a short "## "
heading taken from the note. Everything else stays as plain sentences. Never add a date, time, name, item or heading
the note doesn't have. Reply with the rewritten note only.

Note:
\"\"\"{text}\"\"\""""

# pipeline/clusters.py — the AI files the notes, in three small steps.
# 1. what one note is about
MATTER = """Read this note and say what it is about, the way a thoughtful assistant would file it: the particular matter,
in 2-4 words, named so that any other note about the same matter would get the same name; what it is about, not merely
the place or person it mentions. Return JSON: {{"matter": ""}}

Note: {note}"""
# 2. whether two matters are one (asked only for pairs close in meaning)
SAME = """Two notes were filed under these names. Are they about the same matter — the same problem, case or plan, so
someone following one would want to find the other in the same folder? Different matters that only happen at the same
time, place or kind of activity are not the same.
A: {a} — a note on it says: {ea}
B: {b} — a note on it says: {eb}
Return JSON: {{"same": true or false, "name": "one short name for both, if the same"}}"""
# 3. the topics into the broad areas of life or work
GROUP = """These are the topics in one person's notes. Group them into the broad areas of their life or work they belong
to (a few areas, each holding the topics that belong together), and name each area in 1-3 words. Every topic goes in one
area; refer to topics by their number.
{theirs}Topics:
{topics}

Return JSON: {{"areas": [{{"name": "", "topics": [numbers]}}]}}"""
PLACE = """One person's notes are sorted into these broad areas of their life or work: {areas}.
Which of them does this topic belong to? If none of them fits, name the new area it belongs to, in 1-3 words.
Topic: {topic} (notes: {titles})

Return JSON: {{"area": ""}}"""

THEIRS = """The person has already named some areas themselves: {names}. Use those names for the topics that belong in them, and only those; the other topics get areas of their own.
"""

# pipeline/extract.py — added to EXTRACT when memory recognised names in the note.
KNOWN = "Already known from the writer's earlier notes (use these spellings):\n{names}\n"

# core/memory.py — what mem0 keeps about the user.
PROFILE = """These are a person's own notes. Keep lasting facts about the WRITER: their role and work, the places and
offices they deal with, people they work with and how, issues they keep returning to, commitments, and preferences.
Skip one-off details of a single note. Write each fact as one short sentence about the user."""

# chat/answer.py — the chatbot's instructions; the notes and context follow it.
ANSWER = """You are the user's assistant for their own notes. Answer in plain, natural language, as you would to them in person.
Use the notes below; when they don't cover something, say so rather than guessing. Mention names, places and dates when
they help. Keep it short unless they ask for detail. Write plain text: no markdown, no asterisks or bullet symbols.
The date in brackets is when a note was written."""

# routes/home.py — the few-line briefing on Home.
BRIEFING = """Write a short briefing (3-4 plain sentences) for someone about their own notes: what is taking their attention,
what needs action from them, and what is coming up. Use only these facts and address them as "you".

{facts}"""

# pipeline/commands.py — only when the text is worded like an instruction: is it one, and what does it ask?
COMMAND = """The user typed or said this into their notes app. Usually it is a note. Sometimes it is, or includes, an
instruction to the app. The app can:
- create_project: make a project (name)
- move: put notes into a project (project)
- pin / unpin: keep notes at the top, or stop
- star / unstar: mark notes as important, or stop
- rename_idea: rename one of their ideas (idea, to)
- merge_ideas: put one idea's notes into another (idea, into)
Which notes: "this" (the note in this same message), "last" (their previous note), or "about" (their existing notes on
a subject; put the subject in "about"). A note that only happens to use these words, without asking the app to do
anything, is not an instruction.

Return JSON:
{{
  "instruction": true if any part of it tells the app to do something, else false,
  "actions": [{{"do": "create_project | move | pin | unpin | star | unstar | rename_idea | merge_ideas", "name": "", "project": "", "which": "this | last | about", "about": "", "idea": "", "to": "", "into": ""}}]
}}

Their projects: {projects}
Their ideas: {ideas}

Text:
\"\"\"{text}\"\"\""""
