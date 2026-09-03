import logo from "../assets/logo.png";

export default function Wordmark() {
  return (
    <div className="header__logo" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <img src={logo} alt="" height={28} width={28} style={{ display: "block" }} />
      <span
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
      </span>
    </div>
  );
}
