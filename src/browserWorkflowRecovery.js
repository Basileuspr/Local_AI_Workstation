const recoverable=new Set(['paused','interrupted']);
// History is only resumed by its explicit recovery button. Starting on a new
// page must not select an unrelated cancelled/completed checkpoint from history.
export function workflowCheckpoint(status) {
  const row=status?.workflow;
  return row && row.profileId===status?.selected && recoverable.has(row.status)?row:null;
}
export async function beginBrowserWorkflow(desktop,status,{fresh=false}={}) {
  const checkpoint=workflowCheckpoint(status);
  if(checkpoint&&!fresh)return desktop.resumeBrowserWorkflow({workflowId:checkpoint.id,profileId:status.selected,restorePage:true});
  if(checkpoint&&fresh) {
    const stopped=await desktop.cancelBrowserWorkflow({workflowId:checkpoint.id});
    if(stopped?.error)return stopped;
  }
  return desktop.startBrowserWorkflow({profileId:status.selected});
}
