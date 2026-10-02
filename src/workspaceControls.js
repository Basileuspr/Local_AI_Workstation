import {chatHelp} from './help/chat';
import {fileToolHelp} from './help/fileTools';
import {mediaHelp} from './help/media';
import {creativeHelp} from './help/creative';
import {workstationHelp} from './help/workstation';
import {modelHelp} from './help/model';
import {workflowSettingsHelp,imageAdjustmentHelp} from './help/workflowSettings';

export const workspaceControls = {
  ...fileToolHelp,
  ...mediaHelp,
  ...creativeHelp,
  ...workstationHelp,
  workflows: [...creativeHelp.workflows,...workflowSettingsHelp],
  'image-editor': [...creativeHelp['image-editor'],imageAdjustmentHelp],
  chats: chatHelp,
  '3d-viewer': modelHelp,
};
