"""Small wording rules shared across the app."""
import re
import uuid

# Two spellings of one name are the same entity at this similarity (difflib ratio): "Massewal"/"Masewal",
# "Mster Harbhjan"/"Master Harbhajan". One threshold everywhere.
NAME_SIM = 0.86

def key(s: str) -> str:
    """Spelling-insensitive identity of a name: "Dhab Wala" = "Dhabwala" = "dhab-wala"; "X.E.N." = "XEN"."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def no_dashes(t: str) -> str:
    """The app never shows em/en dashes: "a — b" reads as "a, b"; a bare en dash in a range is a hyphen ("2–3")."""
    return " ".join(t.replace(" — ", ", ").replace(" – ", ", ").replace("—", ", ").replace("–", "-").split()).strip()

def is_uuid(v: str) -> bool:
    """Whether a path id is a UUID — checked before it reaches SQL."""
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False
