// Header workspace operasional bersama. Menjaga hierarchy Alat Berat dan ATTB
// konsisten tanpa menduplikasi blok visual besar di masing-masing komponen.
export function OperationsHero({ eyebrow, title, description, scope, metrics, controls, className = "" }) {
  return (
    <section className={`operations-hero operations-hero--summary-only ${className}`.trim()} aria-label={`${eyebrow}: ${title}`}>
      <div className="operations-hero__summary-copy">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {controls && <div className="operations-hero__controls">{controls}</div>}
      <div className="operations-hero__footer">
        <div className="operations-hero__metrics">
          {metrics.map(metric=>(
            <div key={metric.label} className={`operations-metric${metric.alert?" is-alert":""}`}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
        <div className="operations-hero__scope"><span>Lingkup data</span><strong>{scope}</strong></div>
      </div>
    </section>
  );
}
