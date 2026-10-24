"""Fixed app-data ownership groups for offline maintenance (never renderer paths)."""

SECTIONS = {
    'chats': ('Chats', 'Saved conversations. Copies in memory, recovery history and phone/PC jobs are separate sections.', ('sessions',)),
    'memory': ('Durable memory', 'Remembered facts and their database sidecars.', ('memory.db', 'memory.db-wal', 'memory.db-shm', 'memory.db-journal')),
    'knowledge': ('Knowledge and Index', 'Indexed documents, graph, saved Index entries and drafts.', ('knowledge_base', 'prompt_index.json', 'prompt_index_draft.json')),
    'media': ('App media and documents', 'App-data images, blobs, Hidden/Locked images, documents, canvas and reels. Saved chats may reference these files.', ('artifacts', 'blobs', 'generated_images', 'image_library', 'locked_images', 'reels')),
    'workflows': ('Image workflows', 'Saved workflows and their app-data assets and results.', ('image_workflows',)),
    'training': ('Characters, faces and LoRAs', 'Character/face datasets, training projects and trained adapters inside app data.', ('lora', 'face_bank', 'face_datasets', 'character_datasets')),
    'web': ('Web research', 'Saved web research, sources and background-monitor settings inside app data. Separate browser profiles remain.', ('web', 'web-system')),
    'utilities': ('Audit and review records', 'Hash Auditor, Folder Review and visual review records.', ('hash_auditor', 'folder_review', 'visual_review')),
    'history': ('Logs, Trash and recovery copies', 'App-data logs, thinking history, Trash and backups. Select this too to remove old copies.', ('logs', 'thinking', 'backups', 'trash')),
    'mobile': ('Phone access and job history', 'Revokes paired phones and removes invitations, phone jobs and connection setup unless retained below.', ('mobile',)),
    'bridge': ('PC bridge', 'PC pairing, connection settings and delegated job history.', ('bridge',)),
    'libraries': ('Storage library registrations', 'Forgets registered library folders and the default destination. External library files remain.', ('storage',)),
    'desktop': ('Desktop settings and browser storage', 'All desktop browser storage, including preferences, saved canvas, prompts, custom profiles/buttons, drafts and cache. Separate browser profiles remain.', ()),
    'other': ('Other app data', 'Remaining app-data files, including legacy catalog copies. Independent manager catalogs remain.', ()),
}


def section_for(name):
    return next((key for key, (_, _, names) in SECTIONS.items() if name in names), 'other')


def reset_options(value):
    if not isinstance(value, dict) or set(value) != {'sections', 'keep_mobile_setup'}:
        raise ValueError('Choose the sections to sanitize and whether to keep phone setup.')
    sections = value['sections']
    if (not isinstance(sections, list) or not sections or len(sections) > len(SECTIONS)
            or any(not isinstance(key, str) or key not in SECTIONS for key in sections)
            or len(set(sections)) != len(sections) or type(value['keep_mobile_setup']) is not bool):
        raise ValueError('Choose at least one valid section to sanitize.')
    if value['keep_mobile_setup'] and 'mobile' not in sections:
        raise ValueError('Phone setup retention applies only when clearing phone access.')
    return {'sections': [key for key in SECTIONS if key in sections], 'keep_mobile_setup': value['keep_mobile_setup']}


def section_inventory(entries):
    groups = {key: {'id': key, 'label': label, 'description': description, 'files': 0, 'bytes': 0}
              for key, (label, description, _) in SECTIONS.items()}
    for relative, size in entries:
        if relative.parts[0] in {'.reset-in-progress.json', '.backend.lock'}:
            continue
        group = groups[section_for(relative.parts[0])]
        group['files'] += 1
        group['bytes'] += size
    return list(groups.values())
