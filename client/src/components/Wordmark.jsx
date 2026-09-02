export default function Wordmark() {
  return (
    <div
      className="header__logo"
      style={{
        fontWeight: 800,
        fontSize: 16,
        letterSpacing: "-0.02em",
        background: "var(--wp-gradient)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        whiteSpace: "nowrap",
      }}
    >
      Workflow Pro
    </div>
  );
}
