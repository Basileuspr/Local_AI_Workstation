import { featureVisuals } from '../infoCenterVisuals';

const paths = {
  chat: 'M3 4h18v13H9l-6 4V4Zm4 5h10M7 13h7',
  document: 'M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8',
  text: 'M4 5h16M4 10h16M4 15h10M4 20h13',
  stack: 'M8 3h13v13M5 6h13v13M2 9h13v13H2Z',
  nodes: 'M5 5 19 12 5 19M5 5v14M19 12h3M2 5h3M2 19h3',
  pen: 'm4 16 12-12 4 4L8 20l-5 1ZM13 7l4 4',
  landscape: 'M2 3h20v18H2ZM2 18l6-8 5 6 3-4 6 6M16 6h2v2h-2Z',
  warm: 'M2 3h20v18H2ZM2 18l6-8 5 6 3-4 6 6M16 6h2v2h-2Z',
  package: 'm2 7 10-5 10 5v11l-10 5-10-5ZM2 7l10 5 10-5M12 12v11M7 4l10 5',
  check: 'm5 12 4 4L20 5M21 12v9H3V3h11',
  status: 'M2 13h4l3-9 5 17 4-8h4',
  wave: 'M3 10v4M7 5v14M12 2v20M17 6v12M21 10v4',
  sliders: 'M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 7h6',
  cube: 'm3 7 9-5 9 5v10l-9 5-9-5ZM3 7l9 5 9-5M12 12v10',
  layers: 'm2 7 10-5 10 5-10 5ZM2 12l10 5 10-5M2 17l10 5 10-5',
  link: 'm9 15 6-6M8 16l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0M16 8l2-2a4 4 0 0 0-5-5L8 6a4 4 0 0 0 0 5',
  gallery: 'M2 2h8v8H2ZM14 2h8v8h-8ZM2 14h8v8H2ZM14 14h8v8h-8Z',
  grid: 'M2 3h20v18H2ZM2 9h20M2 15h20M9 3v18M16 3v18',
  tag: 'M3 3h9l10 10-9 9L3 12ZM7 7h1v1H7',
  frames: 'M2 5h20v14H2ZM7 5v14M17 5v14M2 10h5M2 15h5M17 10h5M17 15h5',
  portrait: 'M8 6a4 4 0 1 0 8 0 4 4 0 0 0-8 0M3 22v-3a9 9 0 0 1 18 0v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  book: 'M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1ZM12 5v15',
  keys: 'M2 5h20v14H2ZM5 9h1M10 9h1M15 9h1M19 9h1M6 15h12',
  browser: 'M2 3h20v18H2ZM2 8h20M5 5h1M9 5h1',
  code: 'm8 5-6 7 6 7M16 5l6 7-6 7M14 3 10 21',
  palette: 'M3 3h8v8H3ZM15 3h6v6h-6ZM3 15h6v6H3ZM14 14h7v7h-7Z',
};

export function FeatureIcon({ kind, className = '' }) {
  return <svg className={`info-feature-icon ${className}`} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind] || paths.document} /></svg>;
}

// Illustrative pictures, deliberately different from screenshots or live status.
function Picture({ kind }) {
  if (kind === 'landscape' || kind === 'warm') return <>
    <rect width="100" height="64" rx="6" fill={kind === 'warm' ? '#f8c58b' : '#aadce7'} />
    <circle className="info-picture-sun" cx="76" cy="17" r="9" fill="#fff2b3" />
    <path d="M0 57 33 14 69 64H0" fill="#648fa6" /><path d="m23 27 10-13 11 16-12-5Z" fill="#f5f7f4" />
    <path d="m37 64 37-39 26 30v9" fill={kind === 'warm' ? '#a47766' : '#426e86'} />
    <path d="M0 55q30-7 55 3t45-4v10H0Z" fill={kind === 'warm' ? '#715f60' : '#25596e'} />
  </>;
  if (kind === 'portrait' || kind === 'eye') return <>
    <rect width="100" height="64" rx="6" fill="#324b63" />
    {kind === 'portrait' ? <><path d="M21 64q3-24 29-24t29 24" fill="#9ea4d8" /><ellipse cx="50" cy="25" rx="16" ry="19" fill="#e7b899" /><path d="M34 25Q25 1 51 3q23 0 16 26l-7-15-25 6" fill="#40363e" /><path d="M41 26h3m12 0h3M46 35q4 3 8 0" stroke="#40363e" strokeWidth="2" /></> : <><path d="M10 32q40-39 80 0-40 39-80 0" fill="#f5e9df" /><circle cx="50" cy="32" r="15" fill="#7fabaa" /><circle cx="50" cy="32" r="7" fill="#263a47" /><circle cx="54" cy="27" r="3" fill="white" /></>}
  </>;
  if (kind === 'wave') return <g stroke="currentColor" strokeWidth="5" strokeLinecap="round">{[12,26,40,22,49,32,18,36,14].map((height, i) => <path key={i} className="info-wave-bar" style={{ '--bar-delay': `${i * 65}ms` }} d={`M${10 + i * 10} ${32-height/2}v${height}`} />)}</g>;
  if (kind === 'document' || kind === 'text') return <>
    <rect x="22" y="2" width="56" height="60" rx="5" fill="var(--bg-card)" stroke="currentColor" />
    <rect x="30" y="11" width="28" height="5" rx="2" fill="currentColor" />
    {kind === 'document' && <rect x="30" y="23" width="15" height="17" rx="2" fill="currentColor" opacity=".25" />}
    <path d={kind === 'document' ? 'M51 25h18M51 32h15M51 39h18M30 48h39M30 54h28' : 'M30 25h39M30 32h32M30 39h39M30 46h35M30 53h22'} stroke="currentColor" strokeWidth="2" opacity=".7" />
  </>;
  if (kind === 'chat') return <><rect x="4" y="7" width="67" height="23" rx="8" fill="currentColor" opacity=".18" /><path d="M13 16h43M13 22h28" stroke="currentColor" strokeWidth="2" /><rect x="25" y="35" width="71" height="23" rx="8" fill="currentColor" opacity=".3" /><path d="M34 44h46M34 50h30" stroke="currentColor" strokeWidth="2" /></>;
  if (kind === 'gallery' || kind === 'frames') return <>{[0,1,2].map(i => <g key={i} transform={`translate(${i*25+3} ${13-i*4})`}><rect width="44" height="43" rx="4" fill="var(--bg-card)" stroke="currentColor" /><path d="m4 34 12-17 10 12 6-7 8 12Z" fill="currentColor" opacity={.3+i*.2} /><circle cx="31" cy="11" r="4" fill="currentColor" /></g>)}</>;
  if (kind === 'nodes') return <><path d="M13 14 50 32 13 50M13 14 50 8 86 32 50 56 13 50M50 32h36" stroke="currentColor" fill="none" opacity=".55" />{[[13,14],[13,50],[50,8],[50,32],[50,56],[86,32]].map(([x,y],i)=><circle className="info-network-node" key={i} cx={x} cy={y} r="5" fill="currentColor" style={{'--bar-delay':`${i*160}ms`}} />)}</>;
  return <g transform="translate(23 5) scale(2.25)" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind] || paths.document} /></g>;
}

export default function InfoCenterVisual({ feature }) {
  const [source, result, input, action, output, motion] = featureVisuals[feature.id] || ['document', 'check', 'Your input', 'Explore', 'Your result'];
  return <figure className={`info-visual ${motion ? `info-motion-${motion}` : ''}`}>
    <svg className="info-example-picture" viewBox="0 0 280 84" role="img" aria-label={`${feature.title} example: ${input} → ${action} → ${output}`}>
      <g transform="translate(7 10)" className="info-picture-input"><Picture kind={source} /></g>
      <path className="info-flow-arrow" d="M122 42h34m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <g transform="translate(173 10)" className="info-picture-result"><Picture kind={result} /></g>
    </svg>
    <figcaption><span>{input}</span><span className="info-visual-action">{action}</span><span>{output}</span></figcaption>
    <span className="info-visual-note">Illustrated example{motion && <span className="info-motion-hint"> · hover or focus to animate</span>}</span>
  </figure>;
}
