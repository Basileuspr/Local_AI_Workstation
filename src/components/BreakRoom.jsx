import { useEffect, useRef, useState } from 'react';
import { shuffledCards, readMatchBest } from '../memoryMatch';
import FaceHelp from './FaceHelp';
import './Learning.css';
import './BreakRoom.css';

export default function BreakRoom({ active = true }) {
  const [cards, setCards] = useState(shuffledCards), [flipped, setFlipped] = useState([]), [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0), [best, setBest] = useState(readMatchBest), [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const pairLock = useRef(false);
  const completed = matched.length === 8;
  useEffect(() => {
    if (flipped.length !== 2 || paused || !active) return;
    const [a, b] = flipped.map(id => cards.find(card => card.id === id));
    const timer = setTimeout(() => {
      if (a.pair === b.pair) setMatched(current => [...current, a.pair]);
      setFlipped([]); pairLock.current = false;
    }, a.pair === b.pair ? 300 : 950);
    return () => clearTimeout(timer);
  }, [flipped, cards, paused, active]);
  useEffect(() => {
    if (!completed || (best !== null && best <= moves)) return;
    setBest(moves);
    try { localStorage.setItem('local-ai-workstation-match-best-v1', String(moves)); }
    catch { setError('This score could not be remembered on this device.'); }
  }, [completed, moves, best]);
  function turn(card) {
    if (pairLock.current || paused || !active || completed || flipped.includes(card.id) || matched.includes(card.pair)) return;
    if (flipped.length === 1) { pairLock.current = true; setMoves(value => value + 1); }
    setFlipped(current => [...current, card.id]);
  }
  function restart() { pairLock.current = false; setCards(shuffledCards()); setFlipped([]); setMatched([]); setMoves(0); setPaused(false); setError(''); }
  return <section className="learning-workspace break-room" aria-label="Break Room">
    <FaceHelp active={active} />
    <header className="learning-heading"><div><span className="learning-eyebrow">TAKE A SHORT BREAK</span><h1>Memory Match</h1><p>Turn over two cards and find all eight pairs. Use the fewest moves you can.</p></div></header>
    <div className="match-status" role="status">{completed ? `All pairs found in ${moves} moves!` : `${matched.length} / 8 pairs · ${moves} move${moves === 1 ? '' : 's'}`}{best !== null && ` · Best: ${best}`}</div>
    <div className="match-board" aria-label="Memory cards">{cards.map((card, index) => {
      const visible = !paused && (flipped.includes(card.id) || matched.includes(card.pair));
      const found = matched.includes(card.pair);
      return <button type="button" key={card.id} className={`match-card${found ? ' matched' : ''}${visible ? ' revealed' : ''}`}
        aria-label={`Card ${index + 1}${visible ? `: ${card.symbol}${found ? ', matched' : ''}` : ', face down'}`}
        aria-pressed={visible} disabled={paused || found || flipped.includes(card.id) || flipped.length === 2 || completed}
        onClick={() => turn(card)}>{visible ? card.symbol : <span aria-hidden="true">?</span>}</button>;
    })}</div>
    <div className="match-actions"><button type="button" onClick={() => setPaused(value => !value)} disabled={completed}>{paused ? 'Resume game' : 'Pause game'}</button><button type="button" onClick={restart}>{completed ? 'Play again' : 'New game'}</button></div>
    {paused && <p role="status">Paused. Cards are hidden until you resume.</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
