import { useDispatch, useStore } from '../useStore';
import { useChatPane } from '../ChatPane';
import { CHAT_WIDTH, normalizeChatWidth } from '../chatLayout';

export default function ChatWidthControl() {
  const state = useStore(), dispatch = useDispatch(), pane = useChatPane();
  const width = normalizeChatWidth(state.chatWidth), id = pane.domId('chat-width');
  const setWidth = value => dispatch({ type: 'SET_CHAT_WIDTH', payload: value });
  return <div className="chat-width-control">
    <label htmlFor={id}>Chat width <output htmlFor={id}>{width} px</output></label>
    <input id={id} type="range" min={CHAT_WIDTH.min} max={CHAT_WIDTH.max} step={CHAT_WIDTH.step}
      value={width} aria-valuetext={`${width} pixels maximum`} aria-describedby={`${id}-help`}
      onChange={event => setWidth(Number(event.target.value))} />
    <p id={`${id}-help`}>Messages and composer resize together. Fits smaller panes; remembered for both chats on this computer.</p>
    <button type="button" disabled={width === CHAT_WIDTH.default} onClick={() => setWidth(CHAT_WIDTH.default)}>Reset width</button>
  </div>;
}
