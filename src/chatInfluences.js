import {buildRoleplaySystemPrompt,mergeRoleplayConfig} from './roleplayPrompt';
import {buildResponseStylePrompt,responseStyles} from './responseStyle';

/** Shared by sending, context budgeting, and the visible next-message preview. */
export function chatInfluences(state) {
  const roleplay=mergeRoleplayConfig(state.roleplay),enabled=Boolean(roleplay.enabled);
  const parts=[];
  const stylePrompt=buildResponseStylePrompt(state.responseStyle);
  if(stylePrompt&&(!enabled||roleplay.includeResponseStyle!==false))parts.push({name:'Response style',text:stylePrompt});
  if((!enabled||roleplay.includeGeneralPrompt!==false)&&state.systemPrompt?.trim())parts.push({name:'General system prompt',text:state.systemPrompt.trim()});
  if(enabled)parts.push({name:'Roleplay',text:buildRoleplaySystemPrompt('',roleplay)});
  const knowledge=state.useKnowledgeBase?(state.knowledgeDocIds==null?'all':'selected'):'off';
  const warnings=[];
  if(enabled&&parts.some(part=>part.name==='General system prompt'))warnings.push('General instructions and roleplay are both included. They can disagree.');
  if(enabled&&roleplay.includeResponseStyle!==false)warnings.push('The general response style can change the character’s voice and formatting.');
  if(enabled&&roleplay.useDurableMemory!==false)warnings.push('Saved user memories can introduce information from outside this roleplay.');
  if(enabled&&knowledge==='all')warnings.push('Knowledge searches all documents, including other characters. Select only the documents for this scene if needed.');
  return {parts,systemPrompt:parts.map(part=>part.text).join('\n\n'),useDurableMemory:!enabled||roleplay.useDurableMemory!==false,warnings,
    summary:{model:state.selectedModel,roleplay:enabled?{name:roleplay.characterName||'Unnamed character',source:roleplay.source}:null,
      generalPrompt:parts.some(part=>part.name==='General system prompt'),responseStyle:parts.some(part=>part.name==='Response style')?(responseStyles[state.responseStyle]||responseStyles.default).label:null,
      durableMemory:!enabled||roleplay.useDurableMemory!==false,knowledge,knowledgeDocIds:state.knowledgeDocIds}};
}
