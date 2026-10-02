import HelpSections from './HelpSections';
import {sharedHelp,previewHelp} from '../help/shared';

const imageTabs=['chats','images','image-manager','review','generate','image-editor','workflows','faces','characters','character-parts','lora','converter','packager','media-manager','gif-maker'];
export default function WorkspaceHelpExtras({tab}) {
  return <HelpSections sections={imageTabs.includes(tab)?[previewHelp,...sharedHelp]:sharedHelp}/>;
}
