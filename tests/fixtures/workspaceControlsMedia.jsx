import '../../media-manager/frontend/organizer';
import '../../media-manager/frontend/organizer.css';

const organizer = document.createElement('media-organizer');
organizer.adapter = {
  state: async () => ({ managedRoot: '', runs: [], customFolders: [], tags: [], job: { status: 'idle', message: '' } }),
  library: async () => ({ records: [], customFolders: [], tags: [], uiRunId: '', summary: {} }),
  review: async () => ({ people: [], tags: [], sources: [], jobs: [] }),
};
document.body.append(organizer);
