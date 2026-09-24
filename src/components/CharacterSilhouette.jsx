import { useEffect, useState } from "react";

const shapes = [
  ["torso", "unspecified", "M72 69 Q100 61 128 69 L120 144 Q100 158 80 144 Z"],
  ["arm", "right", "M70 72 Q58 71 54 86 L37 137 L31 174 L44 177 L55 140 L74 99 Z"],
  ["arm", "left", "M130 72 Q142 71 146 86 L163 137 L169 174 L156 177 L145 140 L126 99 Z"],
  ["hand", "right", "M31 176 L43 179 L40 199 Q34 211 28 202 L25 190 Z"],
  ["hand", "left", "M169 176 L157 179 L160 199 Q166 211 172 202 L175 190 Z"],
  ["pelvis", "unspecified", "M80 146 Q100 158 120 146 L125 177 L101 193 L75 177 Z"],
  ["leg", "right", "M76 178 L98 192 L94 246 L89 302 L73 302 L71 248 Z"],
  ["leg", "left", "M124 178 L102 192 L106 246 L111 302 L127 302 L129 248 Z"],
  ["foot", "right", "M73 305 L89 305 L90 321 Q85 330 61 329 L59 321 Z"],
  ["foot", "left", "M127 305 L111 305 L110 321 Q115 330 139 329 L141 321 Z"],
];

export default function CharacterSilhouette({ part, side, onSelect, catalog }) {
  const [view, setView] = useState(["buttocks", "back"].includes(part) ? "back" : "front");
  useEffect(() => { if (["buttocks", "back"].includes(part)) setView("back"); }, [part]);
  const back = view === "back";
  function control(region, anatomicalSide) {
    const label = `${catalog.parts[region]}${anatomicalSide === "unspecified" ? "" : ` · ${catalog.sides[anatomicalSide]}`}`;
    return { role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": part === region && (!side || side === anatomicalSide),
      onClick: () => onSelect(region, anatomicalSide), onKeyDown: event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(region, anatomicalSide); } } };
  }
  return <aside className="character-silhouette">
    <h3>Choose a region</h3>
    <div className="character-map-views" role="group" aria-label="Silhouette view">{["front", "back"].map(value => <button type="button" key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value === "front" ? "Front view" : "Back view"}</button>)}</div>
    <svg viewBox="0 0 200 344" aria-label={`Character silhouette, ${view} view`} className="character-map">
      <ellipse cx="100" cy="35" rx="23" ry="29" className="character-head" />
      <path d="M89 62 L89 69 L111 69 L111 62" className="character-head" />
      {shapes.map(([region, anatomicalSide, path]) => {
        const target = back && region === "torso" ? "back" : back && region === "pelvis" ? "buttocks" : region;
        const mappedSide = back && anatomicalSide !== "unspecified" ? (anatomicalSide === "left" ? "right" : "left") : anatomicalSide;
        const outline = back && region === "pelvis" ? "M80 146 Q100 154 120 146 L126 168 Q129 186 115 192 Q104 194 100 182 Q96 194 85 192 Q71 187 74 168 Z" : path;
        return <path key={`${region}-${anatomicalSide}`} d={outline} {...control(target, mappedSide)} />;
      })}
      {back ? <path className="character-map-detail" d="M100 82 L100 137 M100 155 L100 179" /> : <>
        <ellipse cx="91" cy="31" rx="6" ry="4" {...control("eye", "right")} />
        <ellipse cx="109" cy="31" rx="6" ry="4" {...control("eye", "left")} />
        <ellipse cx="100" cy="47" rx="8" ry="4" {...control("mouth", "unspecified")} />
      </>}
      <text x="16" y="61">{back ? "L" : "R"}</text><text x="176" y="61">{back ? "R" : "L"}</text>
    </svg>
    <div className="character-map-shortcuts">{["body", "back", "buttocks", "custom", "finger", "toe"].map(value => <button key={value} type="button" aria-pressed={part === value} onClick={() => onSelect(value, "")}>{catalog.parts[value]}</button>)}</div>
    <small>Left and right refer to the character. Select finer regions in the region list.</small>
  </aside>;
}
