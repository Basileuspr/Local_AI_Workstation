from pathlib import Path


def import_journal(root):
    root = Path(root).absolute()
    return root.parent / f".law-import-{root.name}.json"
