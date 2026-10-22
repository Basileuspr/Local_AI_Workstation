import CodeBlock from './CodeBlock';
import { codeFence, closesFence } from '../markdownTasks';

// The phone renders prose as text; share code blocks without desktop image APIs.
export default function CodeMessage({ children }) {
  const lines = String(children || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const start = index, fence = codeFence(lines[index]);
    if (fence) {
      const code = []; index++;
      while (index < lines.length && !closesFence(lines[index], fence)) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<CodeBlock key={start} language={fence.info} code={code.join('\n')} />);
    } else {
      const prose = [lines[index++]];
      while (index < lines.length && !codeFence(lines[index])) prose.push(lines[index++]);
      blocks.push(<div className="message-prose" key={start}>{prose.join('\n')}</div>);
    }
  }
  return <div className="code-message">{blocks}</div>;
}
