"""Markdown checklist edits and persistent, item-level change history."""
import re

TASK = re.compile(r"^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\](?:[ \t]+(.*)|$)")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")

CHECKLIST_INSTRUCTION = (
    "This chat supports interactive Markdown checklists. When asked for a to-do list, "
    "task list, or checklist, write each task as '- [ ] Task' (incomplete) or '- [x] Task' "
    "(complete). Place the list directly in the reply, outside code fences. The app lets "
    "the user click the boxes, edit task text, add or remove tasks, and save with the conversation. "
    "Do not claim that clickable checklists are unavailable. Use no HTML or JavaScript."
)


def wants_checklist(prompt):
    return bool(re.search(r"\b(?:check\s*lists?|to[\s-]?do(?:\s+lists?)?|task\s+lists?)\b", prompt, re.I))


def set_task_checked(content, line_index, checked):
    # Retain the original line endings and every character outside the marker.
    parts = re.split(r"(\r\n|\r|\n)", content)
    lines = parts[::2]
    if line_index < 0 or line_index >= len(lines):
        raise ValueError("Checklist item not found")
    opening = None
    for index, line in enumerate(lines):
        fence = FENCE.match(line)
        inside_code = opening is not None
        if opening:
            if (fence and fence[1][0] == opening[0] and len(fence[1]) >= len(opening)
                    and not fence[2].strip()):
                opening = None
        elif fence:
            opening = fence[1]
        if index == line_index:
            task = TASK.match(line)
            if inside_code or fence or not task:
                raise ValueError("This line is not a Markdown checklist item")
            position = task.start(2)
            parts[index * 2] = line[:position] + ("x" if checked else " ") + line[position + 1:]
            return "".join(parts)


def checklist_lines(content):
    opening = None
    tasks = {}
    for index, line in enumerate(re.split(r"\r\n|\r|\n", content)):
        fence = FENCE.match(line)
        if opening:
            if fence and fence[1][0] == opening[0] and len(fence[1]) >= len(opening) and not fence[2].strip():
                opening = None
            continue
        if fence:
            opening = fence[1]
        elif task := TASK.match(line):
            tasks[index] = task
    return tasks


def checklist_history_change(before, after, items=None):
    """Use editor line identities so duplicate text and simultaneous edits stay distinct."""
    def snapshot(content):
        return [dict(line_index=line, text=task[3] or "", checked=task[2].lower() == "x")
                for line, task in checklist_lines(content).items()]

    previous, current = snapshot(before), snapshot(after)
    old = {item["line_index"]: item for item in previous}
    submitted = current if items is None else items
    kept = {item["line_index"] for item in submitted if item["line_index"] is not None}
    changes = [dict(kind="removed", before=item) for item in previous if item["line_index"] not in kept]
    for item in submitted:
        original = old.get(item["line_index"])
        updated = dict(text=item["text"], checked=item["checked"])
        if original is None:
            changes.append(dict(kind="added", after=updated))
            continue
        if original["text"] != item["text"]:
            changes.append(dict(kind="edited", before=original, after=updated))
        if original["checked"] != item["checked"]:
            changes.append(dict(kind="completed" if item["checked"] else "reopened", before=original, after=updated))
    return dict(action="toggle" if items is None else "edit", before=previous, after=current, changes=changes)


def edit_checklist(content, items):
    """Replace/remove task lines only. Surrounding prose and code remain verbatim."""
    tasks = checklist_lines(content)
    updates = {}
    added = []
    previous = -1
    for item in items:
        text = item["text"]
        if any(char in text for char in "\r\n"):
            raise ValueError("Each checklist item must be on one line")
        line = item["line_index"]
        marker = "x" if item["checked"] else " "
        if line is None:
            added.append(f"- [{marker}] {text}")
        else:
            if line not in tasks or line <= previous:
                raise ValueError("Checklist items changed. Reload the chat and try again.")
            previous = line
            updates[line] = f"{tasks[line][1]}[{marker}] {text}"
    parts = re.split(r"(\r\n|\r|\n)", content)
    newline = next(iter(parts[1::2]), "\n")
    last = max(tasks, default=-1)
    result = []
    for index, line in enumerate(parts[::2]):
        ending = parts[index * 2 + 1] if index * 2 + 1 < len(parts) else ""
        if index not in tasks:
            result.append(line + ending)
        elif index in updates:
            result.append(updates[index] + (ending or (newline if added and index == last else "")))
        if index == last and added:
            result.append(newline.join(added) + (ending if ending else ""))
    if last == -1 and added:
        if content and not content.endswith(("\r", "\n")):
            result.append(newline)
        result.append(newline.join(added))
    return "".join(result)
