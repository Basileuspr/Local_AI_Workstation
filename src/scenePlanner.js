// Human-readable review of the bounded patches, with no provider text as markup.
export function sceneActionChanges(state, action) {
  const result = [];
  const visit = (before, changes, path = '') => {
    for (const [key, after] of Object.entries(changes || {})) {
      if (after === null || after === undefined) continue;
      const label = path ? `${path} / ${key.replaceAll('_', ' ')}` : key.replaceAll('_', ' ');
      if (key === 'objects' && Array.isArray(after)) {
        for (const object of after) {
          const previous = state.objects?.find(item => item.id === object.id);
          visit(previous || {}, Object.fromEntries(Object.entries(object).filter(([field]) => field !== 'id')), `Object ${object.name || previous?.name || object.id}`);
        }
      } else if (typeof after === 'object' && !Array.isArray(after)) {
        visit(before?.[key] || {}, after, label);
      } else if (before?.[key] !== after) {
        result.push({field: label, before: before?.[key] || '(empty)', after: after || '(clear)'});
      }
    }
  };
  visit(state, action.changes);
  for (const id of action.remove_objects || []) result.push({field:`Remove object ${state.objects?.find(item => item.id === id)?.name || id}`,before:'Present',after:'Removed'});
  return result;
}

export function previewSceneAction(state, action) {
  const next = structuredClone(state);
  for (const [key, patch] of Object.entries(action.changes || {})) {
    if (patch === null || patch === undefined) continue;
    if (key === 'objects') {
      for (const object of patch) {
        const index = next.objects.findIndex(item => item.id === object.id);
        const fields = Object.fromEntries(Object.entries(object).filter(([,value]) => value !== null));
        if (index < 0) next.objects.push(fields); else Object.assign(next.objects[index], fields);
      }
    } else if (typeof patch === 'object') {
      Object.assign(next[key], Object.fromEntries(Object.entries(patch).filter(([,value]) => value !== null)));
    } else next[key] = patch;
  }
  next.objects = next.objects.filter(object => !(action.remove_objects || []).includes(object.id));
  return next;
}

export function reviewedActions(plan, selected = plan.proposal.actions.map((_,index) => index)) {
  let state = plan.base_state;
  return plan.proposal.actions.map((action,index) => {
    const changes = sceneActionChanges(state, action);
    if (selected.includes(index)) state = previewSceneAction(state, action);
    return {...action, review:changes};
  });
}
