export default function HelpSections({sections}) {
  return sections.map(([heading,entries])=><section key={heading}>
    <h3>{heading}</h3>
    <dl className="workspace-control-help">{entries.map(([name,description])=><div key={name}>
      <dt>{name}</dt><dd>{description}</dd>
    </div>)}</dl>
  </section>);
}
