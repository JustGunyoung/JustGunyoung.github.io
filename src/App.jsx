// ─────────────────────────────────────────────────────────────────────────────
// App.jsx  —  SIGINT-themed personal landing for Gunyoung Park.
//
// Architecture:
//   App                  — root; owns animation loop, section state machine
//   ├── GridBg           — static phosphor grid (CSS only)
//   ├── RadarRingsCanvas — static circular grid + outer border (low z; behind content)
//   ├── Scanlines        — CRT scanline overlay (CSS only)
//   ├── Vignette         — radial edge darkening (CSS only)
//   ├── TopBar           — fixed header with clock; logo navigates home
//   ├── MainContent      — name + buttons; pulses with radar sweep
//   │   ├── NavButton    — CTA button; onClick triggers radar transition
//   │   └── PulseDot     — animated green status dot
//   ├── RadarCanvas      — full-screen sweep/trail/blips + mask wedge (above content)
//   ├── SectionResume    — fixed full-screen overlay, revealed by radar
//   ├── SectionPortfolio — fixed full-screen overlay
//   └── SectionAlbum     — fixed full-screen overlay
//
// Navigation:
//   Page is permanently non-scrollable. Clicking a nav button arms a radar
//   wipe that is locked to the live sweep angle: as the sweep continues its
//   normal rotation, content behind it is masked off (cover, 1 rev), then
//   the section is swapped, then a second rotation reveals the new content
//   (reveal, 1 rev). The wipe is not a separate animation — it's the actual
//   sweep line drawing a wedge mask.
//
// Sweep-synchronised glow:
//   MainContent receives the live `angle` each frame. Title (≈ 12 o'clock)
//   and buttons (≈ 6 o'clock) glow with phosphor afterglow as the sweep
//   passes their angular position — same physics as blip contacts.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Animation constants ─────────────────────────────────────────────────────
const TWO_PI      = Math.PI * 2;
const TRAIL_ANGLE = Math.PI * 0.2;
const RPM         = 0.6;
const TOTAL_SPIN  = TWO_PI * 1.6;

// ─── Design tokens (still used in canvas drawing + dynamic inline styles) ────
const C = {
  bg:       "#07090C",
  panel:    "#0D1117",
  border:   "#1A2A1A",
  green:    "#1DFF6F",
  greenDim: "#0A4020",
  amber:    "#FFB300",
  amberDim: "#7A5500",
  cyan:     "#00E5FF",
  text:     "#C8D0C8",
  textDim:  "#3A4A3A",
};

const lerp  = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Computes how brightly the radar sweep is currently illuminating an element
// at `elementAngle` radians. Returns 0–1 with phosphor afterglow decay.
// Mirrors the blip brightness formula used in RadarCanvas.
function sweepBrightness(sweepAngle, elementAngle) {
  const da = ((sweepAngle - elementAngle) % TWO_PI + TWO_PI) % TWO_PI;
  return Math.pow(Math.max(0, 1 - da / (Math.PI * 0.7)), 1.5);
}


// =============================================================================
// RadarCanvas
//   maskFrom / maskTo: canvas-radian wedge to paint with bg, hiding the
//   content layer underneath. The wedge goes from maskFrom CLOCKWISE to
//   maskTo. Pass null/null to skip masking. Same value family for intro,
//   cover, and reveal — App computes them from the live sweep angle so the
//   mask edge always sits exactly on the sweep line.
//   sweepOpacity (0 … 1): multiplier applied to the *dynamic* radar elements
//   only — sweep trail, sweep line, and blips. Rings and the mask are
//   unaffected. Lets section pages quiet down without losing the wipe.
// =============================================================================
function RadarCanvas({ angle, maskFrom, maskTo, sweepOpacity }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R  = Math.hypot(cx, cy) * 1.05;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Rings and outer border now live in RadarRingsCanvas (lower z-index, so
    // the static circular grid sits behind the title and buttons).

    // ── Step 2: Sweep trail (faded by sweepOpacity) ──
    const trailStart = angle - TRAIL_ANGLE;
    const STEPS = 60;
    for (let i = 0; i < STEPS; i++) {
      const t  = i / STEPS;
      const a0 = lerp(trailStart, angle, t);
      const a1 = lerp(trailStart, angle, (i + 1) / STEPS);
      ctx.save();
      ctx.globalAlpha = sweepOpacity;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = `rgba(29,255,111,${t * 0.22})`;
      ctx.fill();
      ctx.restore();
    }

    // ── Step 3: Sweep line (faded by sweepOpacity) ──
    ctx.save();
    ctx.globalAlpha = sweepOpacity;
    ctx.strokeStyle = C.green;
    ctx.lineWidth   = 2;
    ctx.shadowColor = C.green;
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
    ctx.stroke();
    ctx.restore();

    // ── Step 4: Black mask wedge (always opaque so wipes stay hard) ──
    // maskSpan is the arc length from maskFrom CW to maskTo. By construction
    // (see App) it is always 0 … 2π, so the sweep edge stays on the sweep
    // line for both cover and reveal phases.
    const maskSpan = (maskFrom !== null && maskTo !== null)
      ? Math.max(0, maskTo - maskFrom)
      : 0;

    if (maskSpan > 1e-4) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 1.2, maskFrom, maskTo);
      ctx.closePath();
      ctx.fillStyle = C.bg;
      ctx.fill();
      ctx.restore();
    }

    // ── Step 5: Radar blips (faded by sweepOpacity) ──
    const blips = [
      { angle: -0.6, r: R * 0.28 },
      { angle:  1.1, r: R * 0.45 },
      { angle:  2.8, r: R * 0.35 },
      { angle:  4.4, r: R * 0.55 },
      { angle:  5.5, r: R * 0.30 },
    ];

    blips.forEach(b => {
      // Hide a blip if it sits inside the current mask wedge.
      if (maskSpan > 1e-4) {
        const offset = ((b.angle - maskFrom) % TWO_PI + TWO_PI) % TWO_PI;
        if (offset < Math.min(maskSpan, TWO_PI)) return;
      }

      const da = ((angle - b.angle) % TWO_PI + TWO_PI) % TWO_PI;
      const brightness = Math.pow(Math.max(0, 1 - da / (Math.PI * 0.7)), 1.5);
      if (brightness < 0.03) return;

      const bx = cx + Math.cos(b.angle) * b.r;
      const by = cy + Math.sin(b.angle) * b.r;

      ctx.save();
      ctx.globalAlpha = sweepOpacity;
      ctx.fillStyle   = `rgba(29,255,111,${0.2 + brightness * 0.8})`;
      ctx.shadowColor = C.green;
      ctx.shadowBlur  = 10 * brightness;
      ctx.beginPath();
      ctx.arc(bx, by, 3 + brightness * 2, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    });

  }, [angle, maskFrom, maskTo, sweepOpacity]);

  return (
    <canvas
      ref={ref}
      className="radar-canvas"
      width={window.innerWidth}
      height={window.innerHeight}
    />
  );
}


// =============================================================================
// RadarRingsCanvas — static concentric grid + outer border.
// Lives on a lower z-index than MainContent so the title and buttons sit in
// front of the rings, making the grid feel like a recessed background plate.
// One-time draw (no animation deps), redrawn only if the component re-mounts.
// =============================================================================
function RadarRingsCanvas() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R  = Math.hypot(cx, cy) * 1.05;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Concentric grid rings.
    ctx.strokeStyle = C.border;
    ctx.lineWidth   = 0.5;
    for (let r = R / 5; r <= R; r += R / 5) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.stroke();
    }

    // Outer border ring.
    ctx.strokeStyle = "#1A3A1A";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.stroke();
  }, []);

  return (
    <canvas
      ref={ref}
      className="radar-canvas radar-canvas--rings"
      width={window.innerWidth}
      height={window.innerHeight}
    />
  );
}


// =============================================================================
// Scanlines / Vignette / GridBg  (CSS-only decorative layers)
// =============================================================================
function Scanlines() { return <div className="scanlines" />; }
function Vignette()  { return <div className="vignette" />; }
function GridBg()    { return <div className="grid-bg" />; }


// =============================================================================
// TopBar
// =============================================================================
function TopBar({ visible, onNav }) {
  const [utc, setUtc] = useState("");

  useEffect(() => {
    const fmt = () => {
      const n = new Date();
      const p = v => String(v).padStart(2, "0");
      setUtc(`${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())} UTC`);
    };
    fmt();
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id);
  }, []);

  const navLinks = [
    { label: "RESUME",    section: "resume"    },
    { label: "PORTFOLIO", section: "portfolio" },
    { label: "ALBUM",     section: "album"     },
  ];

  return (
    <div className="topbar" style={{ opacity: visible ? 1 : 0 }}>
      <div className="topbar-left">
        {/* Logo navigates home */}
        <button className="topbar-logo" onClick={() => onNav(null)}>
          ◈ SIGINT // STATION-01
        </button>
        <nav className="topbar-nav">
          {navLinks.map(link => (
            <TopBarNavLink key={link.section} onClick={() => onNav(link.section)}>
              {link.label}
            </TopBarNavLink>
          ))}
        </nav>
      </div>
      <span className="topbar-right">
        <span className="topbar-clock">{utc}</span>
        LAT 40.4259° N · LON 86.9081° W
      </span>
    </div>
  );
}


// =============================================================================
// TopBarNavLink
// =============================================================================
function TopBarNavLink({ children, onClick }) {
  return (
    <button className="nav-link" onClick={onClick}>
      {children}
    </button>
  );
}


// =============================================================================
// NavButton
// Props: delay (entrance stagger seconds), visible (boolean), glow (0–1),
//        onClick (function)
// =============================================================================
function NavButton({ children, glow = 0, onClick }) {
  const glowStyle = glow > 0.05
    ? {
        boxShadow:   `0 0 ${20 * glow}px rgba(29,255,111,${glow * 0.4}), inset 0 0 ${10 * glow}px rgba(29,255,111,${glow * 0.15})`,
        borderColor: `rgba(29,255,111,${0.1 + glow * 0.9})`,
      }
    : {};

  return (
    <button
      className="nav-button"
      onClick={onClick}
      style={glowStyle}
    >
      {children}
    </button>
  );
}


// =============================================================================
// MainContent
// Props: revealed (0→1), angle (radians), hidden (bool), onNav (fn)
// =============================================================================
function MainContent({ revealed, angle, hidden, onNav }) {
  const topVisible  = revealed > 0.30;

  // Phosphor glow when sweep passes each element's angular position.
  // Buttons use offset angles so each one lights up at a slightly different time.
  const titleBr    = sweepBrightness(angle, -Math.PI / 2);       // 12 o'clock
  const albumBr    = sweepBrightness(angle,  Math.PI / 2 - 1); // hits first (right)
  const portfolioBr= sweepBrightness(angle,  Math.PI / 2);       // hits second (center)
  const resumeBr   = sweepBrightness(angle,  Math.PI / 2 + 1); // hits third (left)

  const nameGlow = topVisible && titleBr > 0.04
    ? `0 0 ${30 * titleBr}px rgba(29,255,111,${titleBr * 0.7})`
    : "none";

  return (
    <div
      className="main-content"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      {/* ── TOP HALF ── */}
      <div className="main-top">

        <div className="name-block">

          <div
            className="name-line"
            style={{ textShadow: nameGlow }}
          >
            <span className="name-bracket">[</span>
            GUNYOUNG
            <span className="name-bracket">]</span>
          </div>

          <div
            className="name-line"
            style={{ textShadow: nameGlow }}
          >
            <span className="name-bracket">[</span>
            PARK
            <span className="name-bracket">]</span>
          </div>

        </div>

        <div className="subtitle">
          ROK NAVY · COMMS &amp; NETWORK ENG · PURDUE CS
        </div>

      </div>


      {/* ── BOTTOM HALF ── */}
      <div className="main-bottom">

        <div className="btn-row">
          <NavButton glow={resumeBr}    onClick={() => onNav("resume")}>
            ↓ RESUME
          </NavButton>
          <NavButton glow={portfolioBr} onClick={() => onNav("portfolio")}>
            ⌥ PORTFOLIO
          </NavButton>
          <NavButton glow={albumBr}     onClick={() => onNav("album")}>
            ◈ ALBUM
          </NavButton>
        </div>

      </div>
    </div>
  );
}


// =============================================================================
// useActiveReveal  —  fires inView once when isActive becomes true.
// Replaces the IntersectionObserver-based useReveal (sections are fixed overlays,
// not scrolled-into-view elements).
// =============================================================================
function useActiveReveal(isActive) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (isActive) setInView(true);
  }, [isActive]);
  return inView;
}


// =============================================================================
// SectionDivider
// =============================================================================
function SectionDivider({ channel, label }) {
  return (
    <div className="section-divider">
      <span className="section-channel">{channel}</span>
      <div className="section-rule" />
      <span className="section-label-text">{label}</span>
    </div>
  );
}


// =============================================================================
// SectionResume
// =============================================================================
function SectionResume({ isActive, onBack }) {
  const inView = useActiveReveal(isActive);

  const skillGroups = [
    {
      title: "Systems",
      color: C.green,
      skills: [
        { label: "C / C++",      pct: 90 },
        { label: "Linux Kernel", pct: 85 },
        { label: "Rust",         pct: 72 },
        { label: "Assembly",     pct: 60 },
      ],
    },
    {
      title: "Networks",
      color: C.amber,
      skills: [
        { label: "TCP/IP",     pct: 96 },
        { label: "RF / Radio", pct: 88 },
        { label: "Security",   pct: 80 },
        { label: "SDR",        pct: 74 },
      ],
    },
    {
      title: "Software",
      color: C.cyan,
      skills: [
        { label: "Python",   pct: 88 },
        { label: "Go",       pct: 78 },
        { label: "ML / AI",  pct: 72 },
        { label: "React/TS", pct: 65 },
      ],
    },
  ];

  const timeline = [
    {
      period:   "2024 – Present",
      role:     "B.S. Computer Science",
      org:      "Purdue University // West Lafayette, IN",
      desc:     "Focusing on systems, networks, and applied AI. Key coursework: OS, Compilers, Networks, ML, Cryptography. Dean's List.",
      dotColor: C.green,
    },
    {
      period:   "20XX – 20XX",
      role:     "Communications & Network Engineer",
      org:      "Republic of Korea Navy",
      desc:     "Designed and operated tactical communications networks for fleet operations. Managed RF systems, network infrastructure, and classified data transmission.",
      dotColor: C.amber,
    },
    {
      period:   "Target: 2025",
      role:     "Software / Systems Engineering Intern",
      org:      "Seeking // Infrastructure · Security · AI",
      desc:     "Open to roles at the systems or infrastructure layer — developer tools, security products, AI infrastructure, or early-stage startups.",
      dotColor: C.green,
      dimmed:   true,
    },
  ];

  return (
    <div
      className="section-panel"
      style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
    >
      <div className="section-inner">
        <SectionDivider channel="CH-03" label="MISSION LOG // RESUME" />

        <div className="resume-grid">

          {/* ── LEFT: Timeline ── */}
          <div>
            <div className="timeline-header">// Service Record</div>
            <div className="timeline-list">
              {timeline.map((item, i) => (
                <div
                  key={i}
                  className="timeline-entry"
                  style={{
                    paddingBottom: i < timeline.length - 1 ? 36 : 0,
                    opacity:       inView ? (item.dimmed ? 0.55 : 1) : 0,
                    transform:     inView ? "translateX(0)" : "translateX(-12px)",
                    transition:    `opacity 0.6s ease ${i * 0.1}s, transform 0.6s ease ${i * 0.1}s`,
                  }}
                >
                  <div
                    className="timeline-dot"
                    style={{ border: `2px solid ${item.dotColor}` }}
                  />
                  <div className="timeline-period">{item.period}</div>
                  <div className="timeline-role">{item.role}</div>
                  <div className="timeline-org">{item.org}</div>
                  <div className="timeline-desc">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Skills ── */}
          <div className="skills-column">
            <div className="skills-header">// Capability Matrix</div>
            {skillGroups.map((group, gi) => (
              <div
                key={group.title}
                className="skill-group"
                style={{
                  opacity:    inView ? 1 : 0,
                  transform:  inView ? "translateX(0)" : "translateX(12px)",
                  transition: `opacity 0.6s ease ${gi * 0.15}s, transform 0.6s ease ${gi * 0.15}s`,
                }}
              >
                <div
                  className="skill-group-title"
                  style={{ color: group.color }}
                >
                  {group.title}
                </div>
                {group.skills.map((sk, si) => (
                  <div
                    key={sk.label}
                    className="skill-row"
                    style={{ marginBottom: si < group.skills.length - 1 ? 10 : 0 }}
                  >
                    <span className="skill-label">{sk.label}</span>
                    <div className="skill-track">
                      <div
                        className="skill-fill"
                        style={{
                          background:          group.color,
                          width:               inView ? `${sk.pct}%` : "0%",
                          transitionDuration:  "1.2s",
                          transitionDelay:     `${gi * 0.15 + si * 0.06}s`,
                        }}
                      />
                    </div>
                    <span className="skill-pct">{sk.pct}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}


// =============================================================================
// SectionPortfolio
// =============================================================================
function SectionPortfolio({ isActive, onBack }) {
  const inView = useActiveReveal(isActive);

  const projects = [
    {
      freq:     "433.920 MHz // P-01",
      name:     "NetSentry",
      desc:     "Real-time network intrusion detection at the kernel level using eBPF. Monitors packet flows with sub-millisecond latency, zero userspace overhead.",
      tags:     ["C", "eBPF", "Linux", "Security"],
      featured: [0, 1],
      link:     "#",
    },
    {
      freq:     "868.000 MHz // P-02",
      name:     "FreqMap",
      desc:     "SDR-based spectrum analyzer with ML anomaly detection. Visualises RF environments and flags unauthorised transmissions using trained classifiers.",
      tags:     ["Python", "GNU Radio", "PyTorch", "SDR"],
      featured: [0, 1],
      link:     "#",
    },
    {
      freq:     "2400.000 MHz // P-03",
      name:     "Callsign",
      desc:     "Distributed key-value store implementing Raft consensus from scratch. Fault-tolerant with linearisable reads and leader election under network partition.",
      tags:     ["Go", "Raft", "gRPC", "Protobuf"],
      featured: [0, 1],
      link:     "#",
    },
    {
      freq:     "5800.000 MHz // P-04",
      name:     "Sigscan",
      desc:     "CLI fingerprinting tool for wireless devices via passive 802.11 beacon frame analysis. Deployed in Navy field environments for RF assessment.",
      tags:     ["Rust", "802.11", "libpcap", "Field Use"],
      featured: [0, 3],
      link:     "#",
    },
  ];

  return (
    <div
      className="section-panel"
      style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
    >
      <div className="section-inner">
        <SectionDivider channel="CH-04" label="PAYLOAD // PORTFOLIO" />

        <div className="project-grid">
          {projects.map((proj, i) => (
            <ProjectCard key={proj.name} proj={proj} delay={i * 0.08} inView={inView} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ proj, delay, inView }) {
  return (
    <a
      href={proj.link}
      className="project-card"
      style={{
        opacity:    inView ? 1 : 0,
        transform:  inView ? "translateY(0)" : "translateY(12px)",
        transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s, background 0.2s ease`,
      }}
    >
      <div className="project-top-border" />
      <div className="project-freq">{proj.freq}</div>
      <div className="project-name">{proj.name}</div>
      <div className="project-desc">{proj.desc}</div>
      <div className="tag-row">
        {proj.tags.map((tag, ti) => (
          <span
            key={tag}
            className={`tag ${proj.featured.includes(ti) ? "tag--featured" : "tag--dim"}`}
          >
            {tag}
          </span>
        ))}
      </div>
    </a>
  );
}


// =============================================================================
// SectionAlbum
// =============================================================================
function SectionAlbum({ isActive, onBack }) {
  const inView = useActiveReveal(isActive);

  const entries = [
    { id: 1, label: "Fleet Operations // 20XX",   sub: "ROK Navy, East Sea",      span: 2, aspectRatio: "16/7" },
    { id: 2, label: "Comms Array Deployment",      sub: "Field Exercise",          span: 1, aspectRatio: "4/3"  },
    { id: 3, label: "Purdue University // 2024",   sub: "West Lafayette, IN",      span: 1, aspectRatio: "4/3"  },
    { id: 4, label: "RF Lab // FreqMap Prototype", sub: "SDR Build, 2024",         span: 1, aspectRatio: "4/3"  },
    { id: 5, label: "Radar Systems Study",         sub: "Coursework Documentation",span: 1, aspectRatio: "4/3"  },
    { id: 6, label: "Seoul, Republic of Korea",    sub: "Home",                    span: 2, aspectRatio: "16/7" },
  ];

  return (
    <div
      className="section-panel"
      style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
    >
      <div className="section-inner section-inner--album">
        <SectionDivider channel="CH-05" label="ARCHIVE // ALBUM" />

        <div className="album-grid">
          {entries.map((entry, i) => (
            <AlbumTile key={entry.id} entry={entry} delay={i * 0.07} inView={inView} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AlbumTile({ entry, delay, inView }) {
  const hue1 = (entry.id * 37 + 140) % 360;
  const hue2 = (entry.id * 73 + 180) % 360;

  return (
    <div
      className={`album-tile${entry.span === 2 ? " album-tile--span2" : ""}`}
      style={{
        aspectRatio: entry.aspectRatio,
        background:  `linear-gradient(135deg, hsl(${hue1},30%,8%) 0%, hsl(${hue2},20%,14%) 100%)`,
        opacity:     inView ? 1 : 0,
        transform:   inView ? "scale(1)" : "scale(0.97)",
        transition:  `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s`,
      }}
    >
      <div className="album-placeholder">[ PHOTO ]</div>
      <div className="album-caption">
        <div className="album-caption-title">{entry.label}</div>
        <div className="album-caption-sub">{entry.sub}</div>
      </div>
      <div className="album-hover-border" />
    </div>
  );
}


// =============================================================================
// App  (root component)
//
// Transition state machine (radar-locked):
//   transitionStart === null            → no transition. Mask only during intro.
//   angle - transitionStart in [0, 2π)  → COVER phase. Mask wedge grows from
//                                          start angle CW to current sweep,
//                                          painting bg over the old content.
//   angle - transitionStart === 2π      → swap currentSection ← pendingSection.
//   angle - transitionStart in [2π, 4π) → REVEAL phase. Mask shrinks; the area
//                                          behind the sweep uncovers the new
//                                          content. Same speed as the radar.
//   angle - transitionStart ≥ 4π        → done; clear transition state.
// =============================================================================
export default function App() {
  const [angle,            setAngle]            = useState(-Math.PI / 2);
  const [revealed,         setRevealed]         = useState(0);
  const [done,             setDone]             = useState(false);
  const [topBarVis,        setTopBarVis]        = useState(false);
  const [currentSection,   setCurrentSection]   = useState(null);
  const [transitionStart,  setTransitionStart]  = useState(null);
  const [pendingSection,   setPendingSection]   = useState(null);
  // Opacity of sweep + trail + blips. 1 during intro, on home, or mid-wipe;
  // ramps to 0 when idle on a section page. Rings + mask are unaffected.
  const [sweepOpacity,     setSweepOpacity]     = useState(1);

  // Refs for the main animation loop (avoid stale closures inside rAF callbacks).
  const rafRef            = useRef(null);
  const lastTimeRef       = useRef(null);
  const totalRef          = useRef(0);
  const doneRef           = useRef(false);
  const transitionStartRef = useRef(null);
  const pendingRef         = useRef(null);
  const currentSectionRef  = useRef(null);
  const sweepOpacityRef    = useRef(1);

  // Fade rates (units/sec). Fade-in is intentionally slow enough to be
  // visibly perceived as a "spool-up" rather than a flash.
  const SWEEP_FADE_IN_RATE  = 1 / 1.2; // 0 → 1 in ~1.2 s
  const SWEEP_FADE_OUT_RATE = 1 / 0.6; // 1 → 0 in ~0.6 s

  // Main rAF loop — runs forever (even post-intro) so `angle` keeps updating
  // for the radar-synchronized glow effect on title and buttons, AND so the
  // transition state machine can tick off cover→swap→reveal milestones.
  const animate = useCallback((ts) => {
    if (lastTimeRef.current === null) lastTimeRef.current = ts;
    const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05);
    lastTimeRef.current = ts;

    const dAngle = RPM * TWO_PI * dt;
    totalRef.current += dAngle;
    const newAngle = -Math.PI / 2 + totalRef.current;
    setAngle(newAngle);

    if (!doneRef.current) {
      setRevealed(clamp(totalRef.current / TWO_PI, 0, 1));
      if (totalRef.current >= TOTAL_SPIN) {
        setDone(true);
        doneRef.current = true;
        setTopBarVis(true);
      } else if (totalRef.current > 0.15 * TWO_PI) {
        setTopBarVis(true);
      }
    }

    // Transition progression (radar-locked).
    if (transitionStartRef.current !== null) {
      const traveled = newAngle - transitionStartRef.current;

      // End of cover (1 rev) → swap content while it's fully masked.
      if (traveled >= TWO_PI && currentSectionRef.current !== pendingRef.current) {
        currentSectionRef.current = pendingRef.current;
        setCurrentSection(pendingRef.current);
      }

      // End of reveal (2 revs) → clear transition state.
      if (traveled >= TWO_PI * 2) {
        transitionStartRef.current = null;
        pendingRef.current = null;
        setTransitionStart(null);
        setPendingSection(null);
      }
    }

    // Sweep opacity ramp — derived from the same state machine.
    const sweepTarget = (
      !doneRef.current
      || transitionStartRef.current !== null
      || currentSectionRef.current === null
    ) ? 1 : 0;

    const cur = sweepOpacityRef.current;
    if (cur !== sweepTarget) {
      const rate = sweepTarget > cur ? SWEEP_FADE_IN_RATE : SWEEP_FADE_OUT_RATE;
      const step = dt * rate;
      const next = sweepTarget > cur
        ? Math.min(sweepTarget, cur + step)
        : Math.max(sweepTarget, cur - step);
      sweepOpacityRef.current = next;
      setSweepOpacity(next);
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  // handleNav — arms a radar wipe transition by recording the current sweep
  // angle. From that point, the existing animation loop drives everything.
  const handleNav = useCallback((section) => {
    if (!doneRef.current) return;
    if (transitionStartRef.current !== null) return;
    if (section === currentSectionRef.current) return;

    const startAngle = -Math.PI / 2 + totalRef.current;
    transitionStartRef.current = startAngle;
    pendingRef.current = section;
    setTransitionStart(startAngle);
    setPendingSection(section);
  }, []);

  // ── Mask wedge for the radar canvas ──
  // The wedge runs from maskFrom CLOCKWISE to maskTo. Span is always 0 … 2π
  // so the leading edge of the mask coincides with the sweep line.
  let maskFrom = null;
  let maskTo   = null;
  if (!done) {
    // Intro: mask covers the un-swept side. Its leading edge IS the sweep.
    const introMaskTo = -Math.PI / 2 + TWO_PI;
    maskFrom = Math.min(angle, introMaskTo);
    maskTo   = introMaskTo;
  } else if (transitionStart !== null) {
    const traveled = angle - transitionStart;
    if (traveled < TWO_PI) {
      // Cover: wedge grows from the click angle to the live sweep.
      maskFrom = transitionStart;
      maskTo   = transitionStart + Math.min(traveled, TWO_PI);
    } else {
      // Reveal: wedge shrinks; the live sweep is its leading edge.
      const revealEnd = transitionStart + TWO_PI * 2;
      maskFrom = Math.min(angle, revealEnd);
      maskTo   = revealEnd;
    }
  }

  return (
    <div
      style={{
        background: C.bg,
        height:     "100%",
        overflow:   "hidden",
        cursor:     "crosshair",
        position:   "relative",
      }}
    >
      {/* ── Atmospheric layers ── */}
      <GridBg />
      <RadarRingsCanvas />
      <Vignette />
      <Scanlines />

      {/* ── Fixed chrome ── */}
      <TopBar visible={topBarVis} onNav={handleNav} />

      {/* ── Hero content (always mounted; hidden when a section is active).
            During the transition the swap is invisible because it happens
            behind a fully-covering radar mask. ── */}
      <MainContent
        revealed={revealed}
        angle={angle}
        hidden={currentSection !== null}
        onNav={handleNav}
      />

      {/* ── Radar canvas — one instance, mask driven by current phase ── */}
      <RadarCanvas
        angle={angle}
        maskFrom={maskFrom}
        maskTo={maskTo}
        sweepOpacity={sweepOpacity}
      />

      {/* ── Section overlays (rendered once done; opacity controlled by isActive) ── */}
      {done && (
        <>
          <SectionResume    isActive={currentSection === "resume"}    onBack={() => handleNav(null)} />
          <SectionPortfolio isActive={currentSection === "portfolio"} onBack={() => handleNav(null)} />
          <SectionAlbum     isActive={currentSection === "album"}     onBack={() => handleNav(null)} />
        </>
      )}
    </div>
  );
}
