import { useEffect, useRef, useState } from 'react';
import { filterLearningLessons, learningCourses, learningPracticePrompt, learningStorageKey, readLearningProgress } from '../learningCourses';
import { appTabLabels } from '../navigation';
import { downloadBlob } from '../downloadBlob';
import './Learning.css';

export default function LearningUniversity({ course = 'university', onOpenWorkspace }) {
  const curriculum = learningCourses[course];
  const [selected, setSelected] = useState(curriculum.lessons[0].id);
  const [progress, setProgress] = useState(() => readLearningProgress(course));
  const [choice, setChoice] = useState(null), [checked, setChecked] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [topic, setTopic] = useState(''), [sampleNotice, setSampleNotice] = useState('');
  const lessonPanel = useRef(null);
  const lesson = curriculum.lessons.find(item => item.id === selected);
  const topics = [...new Set(curriculum.lessons.map(item => item.module))];
  const filtered = filterLearningLessons(course, { query, topic });
  const complete = curriculum.lessons.filter(item => progress[item.id]?.passed).length;
  useEffect(() => {
    try { localStorage.setItem(learningStorageKey(course), JSON.stringify(progress)); setError(''); }
    catch { setError('Your work is available in this window, but could not be saved on this device. Export your notes to keep a copy.'); }
  }, [course, progress]);
  function choose(id) {
    setSelected(id); setChoice(null); setChecked(false); setNotice(''); setSampleNotice('');
    requestAnimationFrame(() => lessonPanel.current?.scrollIntoView({ block: 'start', inline: 'nearest' }));
  }
  const update = changes => setProgress(current => ({ ...current, [selected]: { ...current[selected], ...changes } }));
  return <section className="learning-workspace learning-course" aria-label={curriculum.title}>
    <header className="learning-heading"><div><span className="learning-eyebrow">LOCAL LEARNING</span><h1>{curriculum.title}</h1><p>{curriculum.subtitle}</p></div>
      <button type="button" onClick={() => downloadBlob(new Blob([JSON.stringify({ course, exported_at: new Date().toISOString(), progress }, null, 2)], { type: 'application/json' }), `${course}-notes.json`)}>Export notes &amp; progress</button></header>
    <div className="learning-progress"><progress value={complete} max={curriculum.lessons.length} aria-label="Course progress" /><span>{complete} of {curriculum.lessons.length} knowledge checks passed</span></div>
    {error && <p role="alert">{error}</p>}
    <div className="learning-layout"><nav className="learning-lessons" aria-label={`${curriculum.title} lessons`}>
      <div className="learning-lesson-filters">
        <label>Find a lesson<input type="search" aria-label={`Search ${curriculum.title} lessons`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Topic, workspace or concept…" /></label>
        <label>Topic<select aria-label={`${curriculum.title} topic`} value={topic} onChange={event => setTopic(event.target.value)}><option value="">All topics</option>{topics.map(name => <option key={name}>{name}</option>)}</select></label>
        <small role="status">{filtered.length} of {curriculum.lessons.length} lessons</small>
      </div>
      <div className="learning-lesson-list">
        {topics.map(name => {
          const items = filtered.filter(item => item.module === name);
          return items.length > 0 && <section className="learning-lesson-group" key={name}><h2>{name}</h2><div className="learning-lesson-group-buttons">
            {items.map(item => <button type="button" key={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => choose(item.id)}>
              <strong>{item.title}</strong><small>{progress[item.id]?.passed ? '✓ Passed · ' : ''}{item.minutes} minute study</small></button>)}
          </div></section>;
        })}
        {!filtered.length && <div className="learning-no-matches"><p>No lessons match. Try another topic or search.</p><button type="button" onClick={() => { setQuery(''); setTopic(''); }}>Clear filters</button></div>}
      </div>
    </nav><article ref={lessonPanel} className="learning-lesson"><span className="learning-eyebrow">{lesson.module}</span><h2>{lesson.title}</h2>
      {lesson.concepts.map(text => <p key={text}>{text}</p>)}
      <section className="learning-app-practice"><h3>Practice in the app</h3>
        <div className="learning-workspace-links" aria-label="Workspaces for this lesson">{lesson.workspaces.map(tab => <button key={tab} type="button" disabled={!onOpenWorkspace} onClick={() => onOpenWorkspace?.(tab)} aria-label={`Open ${appTabLabels[tab]} for this lesson`}>{appTabLabels[tab]} ↗</button>)}</div>
        <p>Open a workspace to practice, then return to {curriculum.title}. Your selected lesson and working notes stay in place.</p>
        {lesson.needs && <p className="learning-prerequisites"><strong>Before you start:</strong> {lesson.needs}</p>}
        {lesson.sample && <div className="learning-sample"><h4>{lesson.sample.title}</h4>
          <pre>{lesson.sample.text}</pre><div className="learning-sample-actions">
            <button type="button" onClick={async () => {
              try { await navigator.clipboard.writeText(lesson.sample.text); setSampleNotice('Practice sample copied.'); }
              catch { setSampleNotice('Could not copy. Select and copy the sample text above.'); }
            }}>Copy sample</button>
            {lesson.sample.filename && <button type="button" onClick={() => downloadBlob(new Blob([lesson.sample.text], { type: lesson.sample.type }), lesson.sample.filename)}>Save practice file</button>}
          </div>{sampleNotice && <p role="status">{sampleNotice}</p>}
        </div>}
        <ol>{lesson.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="learning-result-check"><h4>Check your result</h4><p>{lesson.checkpoint}</p></div>
      </section>
      <section className="learning-practice"><h3>Try it yourself</h3><p>{lesson.exercise}</p>
        <label>Your working notes<textarea aria-label="Lesson notes" maxLength={12000} value={progress[selected]?.notes || ''} onChange={event => update({ notes: event.target.value })} placeholder="Work through the exercise here. Notes are saved on this device." /></label>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(learningPracticePrompt(course, lesson.id)); setNotice('Practice prompt copied. Paste it into a chat when you want to work with your local model.'); }
          catch { setNotice('Could not copy the practice prompt. You can copy the exercise text above.'); }
        }}>Copy practice prompt</button>{notice && <p role="status">{notice}</p>}
      </section>
      <form className="learning-check" onSubmit={event => { event.preventDefault(); if (choice === null) return; setChecked(true); if (choice === lesson.answer) update({ passed: true }); }}>
        <fieldset><legend>{lesson.question}</legend>{lesson.choices.map((text, index) => <label key={text}>
          <input type="radio" name={`check-${course}`} checked={choice === index} onChange={() => { setChoice(index); setChecked(false); }} />{text}</label>)}</fieldset>
        <button type="submit" disabled={choice === null}>Check answer</button>
        {checked && <p role="status">{choice === lesson.answer ? 'Correct. ' : 'Try again. '}{lesson.explanation}</p>}
      </form>
      <div className="learning-actions"><button type="button" disabled={curriculum.lessons[0].id === selected} onClick={() => choose(curriculum.lessons[curriculum.lessons.findIndex(item => item.id === selected) - 1].id)}>Previous lesson</button>
        <button type="button" disabled={curriculum.lessons.at(-1).id === selected} onClick={() => choose(curriculum.lessons[curriculum.lessons.findIndex(item => item.id === selected) + 1].id)}>Next lesson</button></div>
    </article></div>
  </section>;
}
