function buildContextMenu(params, contents) {
    const items = [];
    if (params.isEditable && params.inputFieldType !== "password" && params.misspelledWord) {
        for (const suggestion of params.dictionarySuggestions || []) {
            items.push({
                // Windows uses ampersands for menu accelerators.
                label: suggestion.replace(/&/g, "&&"),
                click: () => contents.replaceMisspelling(suggestion),
            });
        }
        if (!items.length) items.push({ label: "No spelling suggestions", enabled: false });
        items.push({
            label: "Add to dictionary",
            click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        }, { type: "separator" });
    }

    const flags = params.editFlags || {};
    items.push(
        { label: "Undo", role: "undo", enabled: flags.canUndo },
        { label: "Redo", role: "redo", enabled: flags.canRedo },
        { type: "separator" },
        { label: "Cut", role: "cut", enabled: flags.canCut },
        { label: "Copy", role: "copy", enabled: flags.canCopy },
        { label: "Paste", role: "paste", enabled: flags.canPaste },
        { label: "Select All", role: "selectAll" },
        { type: "separator" },
        { label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) },
    );
    return items;
}

module.exports = { buildContextMenu };
