// ─────────────────────────────────────────────────────────────────────────────
// App.jsx  —  SIGINT-themed personal landing for Gunyoung Park.
//
// Architecture:
//   App                  — root; owns animation loop, section state machine
//   ├── GridBg           — static phosphor grid (CSS only)
//   ├── Scanlines        — CRT scanline overlay (CSS only)
//   ├── Vignette         — radial edge darkening (CSS only)
//   ├── TopBar           — fixed header with clock; logo navigates home
//   ├── MainContent      — name + buttons; pulses with radar sweep
//   │   ├── NavButton    — CTA button; onClick triggers radar transition
//   │   ├── Cursor       — blinking terminal cursor
//   │   └── PulseDot     — animated green status dot
//   ├── RadarCanvas      — full-screen radar (runs forever; wipes on nav)
//   ├── StatusBar        — bottom fixed bar with live readouts
//   ├── SectionResume    — fixed full-screen overlay, revealed by radar
//   ├── SectionPortfolio — fixed full-screen overlay
//   └── SectionAlbum     — fixed full-screen overlay
//
// Navigation:
//   Page is permanently non-scrollable. Clicking a nav button triggers a
//   radar wipe: the sweep covers the screen (3× speed), content switches,
//   then the radar reveals the new content at normal speed. Clicking the
//   logo or a topbar link navigates back home the same way.
//
// Sweep-synchronised glow:
//   MainContent receives the live `angle` each frame. Title (≈ 12 o'clock)
//   and buttons (≈ 6 o'clock) glow with phosphor afterglow as the sweep
//   passes their angular position — same physics as blip contacts.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Animation constants ─────────────────────────────────────────────────────
const TWO_PI      = Math.PI * 2;
const TRAIL_ANGLE = Math.PI * 0.55;
const RPM         = 0.38;
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
// =============================================================================
function RadarCanvas({ angle, revealed }) {
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

    // ── Step 1: Concentric grid rings ──
    ctx.save();
    ctx.strokeStyle = C.border;
    ctx.lineWidth   = 0.5;
    for (let r = R / 5; r <= R; r += R / 5) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
    ctx.stroke();
    ctx.restore();

    // ── Step 2: Sweep trail (phosphor afterglow) ──
    const trailStart = angle - TRAIL_ANGLE;
    const STEPS = 60;
    for (let i = 0; i < STEPS; i++) {
      const t  = i / STEPS;
      const a0 = lerp(trailStart, angle, t);
      const a1 = lerp(trailStart, angle, (i + 1) / STEPS);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = `rgba(29,255,111,${t * 0.22})`;
      ctx.fill();
      ctx.restore();
    }

    // ── Step 3: Sweep line ──
    ctx.save();
    ctx.strokeStyle = C.green;
    ctx.lineWidth   = 2;
    ctx.shadowColor = C.green;
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
    ctx.stroke();
    ctx.restore();

    // ── Step 4: Black mask (hides un-swept content) ──
    const revealedAngle = clamp(revealed, 0, 1) * TWO_PI;
    const maskStart = -Math.PI / 2 + revealedAngle;

    if (revealedAngle < TWO_PI) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 1.2, maskStart, -Math.PI / 2 + TWO_PI);
      ctx.closePath();
      ctx.fillStyle = C.bg;
      ctx.fill();
      ctx.restore();
    }

    // ── Step 5: Radar blips ──
    const blips = [
      { angle: -0.6, r: R * 0.28 },
      { angle:  1.1, r: R * 0.45 },
      { angle:  2.8, r: R * 0.35 },
      { angle:  4.4, r: R * 0.55 },
      { angle:  5.5, r: R * 0.30 },
    ];

    blips.forEach(b => {
      const normalised = ((b.angle + Math.PI / 2) % TWO_PI + TWO_PI) % TWO_PI;
      if (normalised > revealedAngle) return;

      const da = ((angle - b.angle) % TWO_PI + TWO_PI) % TWO_PI;
      const brightness = Math.pow(Math.max(0, 1 - da / (Math.PI * 0.7)), 1.5);
      if (brightness < 0.03) return;

      const bx = cx + Math.cos(b.angle) * b.r;
      const by = cy + Math.sin(b.angle) * b.r;

      ctx.save();
      ctx.fillStyle   = `rgba(29,255,111,${0.2 + brightness * 0.8})`;
      ctx.shadowColor = C.green;
      ctx.shadowBlur  = 10 * brightness;
      ctx.beginPath();
      ctx.arc(bx, by, 3 + brightness * 2, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    });

    // ── Step 6: Outer border ring ──
    ctx.save();
    ctx.strokeStyle = "#1A3A1A";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();

  }, [angle, revealed]);

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
function NavButton({ children, delay, visible, glow = 0, onClick }) {
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
      style={{
        opacity:            visible ? 1 : 0,
        transform:          visible ? "translateY(0)" : "translateY(10px)",
        transitionProperty: "opacity, transform",
        transitionDuration: "0.6s, 0.6s",
        transitionDelay:    `${delay}s, ${delay}s`,
        ...glowStyle,
      }}
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
  const tagVisible  = revealed > 0.18;
  const topVisible  = revealed > 0.30;
  const btnsVisible = revealed > 0.72;

  // Phosphor glow when sweep passes each element's angular position
  const titleBr = sweepBrightness(angle, -Math.PI / 2); // 12 o'clock
  const btnsBr  = sweepBrightness(angle,  Math.PI / 2); // 6 o'clock

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

        <div
          className="signal-tag"
          style={{
            opacity:   tagVisible ? 1 : 0,
            transform: tagVisible ? "translateY(0)" : "translateY(8px)",
          }}
        >
          ▸ SIGNAL ACQUIRED · DECRYPTING IDENTITY
        </div>

        <div className="name-block">

          <div
            className="name-line"
            style={{
              opacity:    topVisible ? 1 : 0,
              transform:  topVisible ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.9s ease 0.1s, transform 0.9s ease 0.1s",
              textShadow: nameGlow,
            }}
          >
            <span className="name-bracket">[</span>
            GUNYOUNG
            <span className="name-bracket">]</span>
          </div>

          <div
            className="name-line"
            style={{
              opacity:    topVisible ? 1 : 0,
              transform:  topVisible ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.9s ease 0.25s, transform 0.9s ease 0.25s",
              textShadow: nameGlow,
            }}
          >
            <span className="name-bracket">[</span>
            PARK
            <span className="name-bracket">]</span>
            <Cursor />
          </div>

        </div>

        <div
          className="subtitle"
          style={{ opacity: topVisible ? 1 : 0 }}
        >
          ROK NAVY · COMMS &amp; NETWORK ENG · PURDUE CS
        </div>

      </div>

      {/* ── DIVIDER ── */}
      <div className="hero-divider" style={{ opacity: topVisible ? 1 : 0 }} />

      {/* ── BOTTOM HALF ── */}
      <div className="main-bottom">

        <div className="btn-row">
          <NavButton delay={0.00} visible={btnsVisible} glow={btnsBr} onClick={() => onNav("resume")}>
            ↓ RESUME
          </NavButton>
          <NavButton delay={0.12} visible={btnsVisible} glow={btnsBr} onClick={() => onNav("portfolio")}>
            ⌥ PORTFOLIO
          </NavButton>
          <NavButton delay={0.24} visible={btnsVisible} glow={btnsBr} onClick={() => onNav("album")}>
            ◈ ALBUM
          </NavButton>
        </div>

        <div
          className="status-badge"
          style={{ opacity: btnsVisible ? 1 : 0 }}
        >
          <PulseDot />
          SEEKING INTERNSHIP 2025
        </div>

      </div>
    </div>
  );
}


// =============================================================================
// Cursor
// =============================================================================
function Cursor() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setOn(v => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="cursor-block"
      style={{ background: on ? C.green : "transparent" }}
    />
  );
}


// =============================================================================
// PulseDot
// =============================================================================
function PulseDot() {
  return <span className="pulse-dot" />;
}


// =============================================================================
// StatusBar
// =============================================================================
function StatusBar() {
  const waveRef   = useRef(null);
  const rafId     = useRef(null);
  const offsetRef = useRef(0);

  const [pkts, setPkts] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPkts(p => p + Math.floor(Math.random() * 12) + 1), 200);
    return () => clearInterval(id);
  }, []);

  const [upSec, setUpSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setUpSec(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const fmtUptime = (s) => {
    const p = v => String(v).padStart(2, "0");
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  };

  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    canvas.width  = 100;
    canvas.height = 18;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      ctx.clearRect(0, 0, 100, 18);
      ctx.strokeStyle = C.green;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      for (let x = 0; x < 100; x++) {
        const t = (x + offsetRef.current) / 18;
        const y = 9
          + Math.sin(t) * 5
          + Math.sin(t * 2.9) * 2
          + (Math.random() - 0.5) * 0.4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      offsetRef.current += 1.8;
      rafId.current = requestAnimationFrame(draw);
    };

    rafId.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const item = (label, value, color = C.green) => (
    <div className="statusbar-item">
      <span className="statusbar-label">{label}</span>
      <span style={{ color, fontWeight: 500 }}>{value}</span>
    </div>
  );

  return (
    <div className="statusbar">
      {item("FREQ", "156.800 MHz")}
      {item("MODE", "USB")}
      {item("RX",   String(pkts % 100000).padStart(5, "0"))}
      <canvas ref={waveRef} style={{ height: 18, width: 100 }} />
      <div className="statusbar-right">
        {item("UPTIME", fmtUptime(upSec))}
        {item("ERR",    "0.00%")}
        {item("SYS",    "NOMINAL")}
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
// =============================================================================
export default function App() {
  const [angle,        setAngle]        = useState(-Math.PI / 2);
  const [revealed,     setRevealed]     = useState(0);
  const [done,         setDone]         = useState(false);
  const [topBarVis,    setTopBarVis]    = useState(false);
  const [currentSection, setCurrentSection] = useState(null);
  const [transitioning,  setTransitioning]  = useState(false);
  const [transRevealed,  setTransRevealed]  = useState(1);

  // Refs for the main animation loop
  const rafRef      = useRef(null);
  const lastTimeRef = useRef(null);
  const totalRef    = useRef(0);
  const doneRef     = useRef(false); // mirrors `done` without stale closure issues

  // Main rAF loop — runs forever (even post-intro) so `angle` keeps updating
  // for the radar-synchronized glow effect on title and buttons.
  const animate = useCallback((ts) => {
    if (lastTimeRef.current === null) lastTimeRef.current = ts;
    const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05);
    lastTimeRef.current = ts;

    const dAngle = RPM * TWO_PI * dt;
    totalRef.current += dAngle;

    setAngle(a => a + dAngle);

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

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  // handleNav — triggers a radar wipe transition to the target section (or null for home).
  const handleNav = useCallback((section) => {
    if (!doneRef.current || transitioning) return;
    if (section === currentSection) return;

    setTransitioning(true);

    // Phase 1: cover sweep — transRevealed goes 1 → 0 at 3× speed
    let rev = 1;
    let lastTs = null;

    const coverLoop = (ts) => {
      if (lastTs === null) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;

      rev = Math.max(0, rev - RPM * 3 * dt);
      setTransRevealed(rev);

      if (rev <= 0) {
        // Screen is fully covered — switch content, then begin reveal
        setCurrentSection(section);

        let revTs = null;
        const revealLoop = (ts2) => {
          if (revTs === null) revTs = ts2;
          const dt2 = Math.min((ts2 - revTs) / 1000, 0.05);
          revTs = ts2;

          rev = Math.min(1, rev + RPM * dt2);
          setTransRevealed(rev);

          if (rev >= 1) {
            setTransitioning(false);
            setTransRevealed(1);
            return;
          }
          requestAnimationFrame(revealLoop);
        };
        requestAnimationFrame(revealLoop);
        return;
      }

      requestAnimationFrame(coverLoop);
    };

    requestAnimationFrame(coverLoop);
  }, [transitioning, currentSection]);

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
      <Vignette />
      <Scanlines />

      {/* ── Fixed chrome ── */}
      <TopBar visible={topBarVis} onNav={handleNav} />
      {done && !transitioning && <StatusBar />}

      {/* ── Hero content (always mounted; hidden when a section is active) ── */}
      <MainContent
        revealed={revealed}
        angle={angle}
        hidden={currentSection !== null}
        onNav={handleNav}
      />

      {/* ── Radar canvas:
            • Normal: full-screen radar runs at all times (revealed stays 1 post-intro)
            • During transition: wipe uses transRevealed (1→0→1) instead ── */}
      {!transitioning && (
        <RadarCanvas angle={angle} revealed={revealed} />
      )}
      {transitioning && (
        <RadarCanvas angle={angle} revealed={transRevealed} />
      )}

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
