import "./playground.css";

const SURFACES = ["surface", "surface-subtle", "surface-sunken"] as const;
const TEXTS = ["text", "text-muted", "accent", "success", "warning", "danger"] as const;
const PAIRS = [
  ["risk-contract-bg", "risk-contract-text", "contract"],
  ["risk-logic-bg", "risk-logic-text", "logic"],
  ["risk-mechanical-bg", "risk-mechanical-text", "mechanical"],
  ["diff-added-bg", "color-text", "added line"],
  ["diff-added-word-bg", "color-text", "added word"],
  ["diff-deleted-bg", "color-text", "deleted line"],
  ["diff-deleted-word-bg", "color-text", "deleted word"],
  ["color-accent-bg", "color-on-accent", "primary button"],
  ["color-accent-subtle", "color-accent", "selected"],
] as const;

/** Every color token in use, for checking both themes by eye: /dev/styles. */
export default function StylesPlayground() {
  return (
    <div className="tokens-playground">
      <h1>Design tokens</h1>
      <h2>Text on surfaces</h2>
      <div className="swatches">
        {SURFACES.map((surface) => (
          <div key={surface} className="swatch" style={{ background: `var(--color-${surface})` }}>
            <strong>{surface}</strong>
            {TEXTS.map((text) => (
              <span key={text} style={{ color: `var(--color-${text})` }}>
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
      <h2>Pairs</h2>
      <div className="swatches">
        {PAIRS.map(([background, color, label]) => (
          <span
            key={label}
            className="pair"
            style={{ background: `var(--${background})`, color: `var(--${color})` }}
          >
            {label}
          </span>
        ))}
      </div>
      <h2>Controls</h2>
      <div className="controls">
        <button type="button" className="button primary">
          Primary
        </button>
        <button type="button" className="button">
          Secondary
        </button>
        <button type="button" className="button" disabled>
          Disabled
        </button>
        <input className="input" placeholder="Input" aria-label="Example input" />
        <input className="input" aria-invalid="true" defaultValue="Invalid" aria-label="Invalid" />
        <a href="#top">Link to the top of the page</a>
        <kbd>/</kbd>
      </div>
      <p className="banner danger">A danger banner.</p>
      <p className="banner warning">A warning banner.</p>
      <div className="skeleton tokens-skeleton" />
    </div>
  );
}
