"""Check public repository Markdown links and the shared document relocation map.

Uses Git's tracked/non-ignored file inventory; never scans private runtime folders.
External URLs are not fetched. Run from any directory with the repository Python.
"""
from pathlib import Path
import json
import re
import subprocess
import unicodedata
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def without_fences(text):
    lines, fence = [], None
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            current = marker.group(1)[0]
            fence = None if fence == current else current if fence is None else fence
            lines.append("")
        else:
            lines.append(line if fence is None else "")
    return "\n".join(lines)


def anchors(text):
    text = without_fences(text)
    result = set(re.findall(r'(?:id|name)=["\x27]([^"\x27]+)', text))
    counts = {}
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", text, re.M):
        heading = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", heading)
        slug = "".join(c for c in heading.lower() if c in " -_" or unicodedata.category(c)[0] in "LN").replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(slug + (f"-{count}" if count else ""))
    return result


def check():
    names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    documents = sorted({name for name in names if name.endswith(".md") and (ROOT / name).is_file()})
    problems, links, cache = [], 0, {}

    def target_problem(source, target):
        parts = urlsplit(target)
        if parts.scheme or parts.netloc:
            return None
        path = ((source.parent / unquote(parts.path)) if parts.path else source).resolve()
        if not path.is_relative_to(ROOT.resolve()):
            return "escapes repository"
        if not path.exists():
            return "missing target"
        if parts.fragment and path.suffix.lower() == ".md":
            if path not in cache:
                cache[path] = anchors(path.read_text(encoding="utf-8"))
            if unquote(parts.fragment) not in cache[path]:
                return "missing heading/anchor"
        return None

    for name in documents:
        source = ROOT / name
        for number, line in enumerate(without_fences(source.read_text(encoding="utf-8")).splitlines(), 1):
            for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", line):
                target = match.group(1).strip().strip("<>")
                if urlsplit(target).scheme or target.startswith("//"):
                    continue
                links += 1
                error = target_problem(source, target)
                if error:
                    problems.append(f"{name}:{number}: {error}: {target}")
    moves = json.loads((ROOT / "docs/development/document-moves.json").read_text(encoding="utf-8"))
    for old, target in moves.items():
        if target is not None:
            error = target_problem(ROOT / "README.md", target)
            if error:
                problems.append(f"document-moves.json: {old}: {error}: {target}")
    for problem in problems:
        print(problem)
    print(f"{len(documents)} Markdown files, {links} local links, {len(moves)} relocation entries; {len(problems)} errors")
    return bool(problems)


if __name__ == "__main__":
    raise SystemExit(check())
