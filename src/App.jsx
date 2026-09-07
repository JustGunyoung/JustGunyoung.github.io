// ─────────────────────────────────────────────────────────────────────────────
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
//   │   └── GlowLetters  — per-letter sweep-driven outline glow on the title
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
//   MainContent receives the live `angle` each frame. Title letters are
//   measured in screen coordinates and each gets an elementAngle derived
//   from its real position; the outline is painted via a CSS mask whose
//   gradient stops carry per-sample brightness along the CW-perpendicular-
//   to-radial direction, so each letter fades in AND out angled across the
//   glyph. Buttons sit near 6 o'clock and light in sequence. Both use the
//   same phosphor-style afterglow physics as the radar blips, with a wider
//   decay window on the title.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";

// ─── Animation constants ─────────────────────────────────────────────────────
const TWO_PI      = Math.PI * 2;
const TRAIL_ANGLE = Math.PI * 0.2;
const RPM         = 0.6;
const TOTAL_SPIN  = TWO_PI * 1.6;
// Canvas angle where the sweep begins its first rotation. π = 9 o'clock (West).
const SWEEP_START = Math.PI;

// ─── Design tokens (still used in canvas drawing + dynamic inline styles) ────
const C = {
  bg:     "#07090C",
  border: "#1A2A1A",
  green:  "#1DFF6F",
  amber:  "#FFB300",
  cyan:   "#00E5FF",
};

const lerp = (a, b, t) => a + (b - a) * t;

// Computes how brightly the radar sweep is currently illuminating an element
// at `elementAngle` radians. Returns 0–1 with phosphor afterglow decay.
// Mirrors the blip brightness formula used in RadarCanvas.
function sweepBrightness(sweepAngle, elementAngle) {
  const da = ((sweepAngle - elementAngle) % TWO_PI + TWO_PI) % TWO_PI;
  return Math.pow(Math.max(0, 1 - da / (Math.PI * 0.7)), 1.5);
}

// Wider-decay variant used by the title — keeps each letter glowing long
// after the sweep passes so the angled fade across the glyph (driven by the
// mask gradient in GlowLetters) has room to play out instead of snapping off
// in a single frame.
function sweepBrightnessTitle(sweepAngle, elementAngle) {
  const da = ((sweepAngle - elementAngle) % TWO_PI + TWO_PI) % TWO_PI;
  return Math.pow(Math.max(0, 1 - da / (Math.PI * 1.75)), 0.5);
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
  // ALBUM is hidden until it holds real photos; SectionAlbum is still wired up,
  // so re-adding the entry here brings it back.
  const navLinks = [
    { label: "RESUME",    section: "resume"    },
    { label: "PORTFOLIO", section: "portfolio" },
    { label: "CONTACTS",  section: "contacts"  },
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
// Props: glow (0–1), onClick (function)
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
// GlowLetters
//   Renders `text` as one <span> per character with a -webkit-text-stroke
//   outline. Each letter is measured in screen coordinates; per frame, we
//   sample sweep brightness at N positions along the CW-perpendicular-to-
//   radial direction at the letter's location, then emit those samples as
//   alpha stops on a CSS linear-gradient mask oriented along the same
//   perpendicular. The mask attenuates the outline per position, so the
//   leading edge of the glyph (where the sweep arrives first) brightens
//   and decays before the trailing edge — both appearance and disappearance
//   sweep diagonally across each letter, with the diagonal angle matching
//   the radial geometry at that letter's screen position.
//
//   `baseAngle` is retained only as a first-frame fallback before refs land.
// =============================================================================
const GLOW_SAMPLES = 5;
const GLOW_EXTENT  = 1.4; // multiplier on letter width: widens angular sampling

function GlowLetters({ text, baseAngle, angle }) {
  const chars   = text.split("");
  const refs    = useRef([]);
  const [rects,  setRects]  = useState([]);
  const [screen, setScreen] = useState(() => ({
    cx: typeof window !== "undefined" ? window.innerWidth  / 2 : 0,
    cy: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  }));

  useLayoutEffect(() => {
    const measure = () => {
      const next = refs.current.map(el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          lx: r.left + r.width  / 2,
          ly: r.top  + r.height / 2,
          w:  r.width,
        };
      });
      setRects(next);
      setScreen({ cx: window.innerWidth / 2, cy: window.innerHeight / 2 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  return chars.map((ch, i) => {
    const rect = rects[i];
    let peakBr;
    let maskImage = null;

    if (!rect) {
      // Fallback before measurement lands: single sample at the legacy angle.
      const t = chars.length > 1 ? i / (chars.length - 1) : 0.5;
      const letterAngle = baseAngle + (t - 0.5) * 0.6;
      peakBr = sweepBrightnessTitle(angle, letterAngle);
    } else {
      const ddx = rect.lx - screen.cx;
      const ddy = rect.ly - screen.cy;
      const dist = Math.max(1e-3, Math.hypot(ddx, ddy));
      // Radial unit vector from screen center to letter; perpendicular in the
      // CW sense is the direction the sweep ray slides across the letter.
      const perpX = -ddy / dist;
      const perpY =  ddx / dist;

      // Per-sample brightness along perpDir. The −perpDir side (stop 0%) is
      // the leading edge the sweep hits first; the +perpDir side (stop 100%)
      // is hit last. Each sample carries its own afterglow curve, so the
      // gradient mask makes both appearance AND disappearance sweep angled
      // across the glyph — the leading edge fades first, the trailing edge
      // hangs on last.
      const samples = new Array(GLOW_SAMPLES);
      peakBr = 0;
      for (let s = 0; s < GLOW_SAMPLES; s++) {
        const t  = (s - (GLOW_SAMPLES - 1) / 2) / (GLOW_SAMPLES - 1);
        const ox = t * rect.w * GLOW_EXTENT * perpX;
        const oy = t * rect.w * GLOW_EXTENT * perpY;
        const sampleAngle = Math.atan2(rect.ly + oy - screen.cy,
                                       rect.lx + ox - screen.cx);
        const br = sweepBrightnessTitle(angle, sampleAngle);
        samples[s] = br;
        if (br > peakBr) peakBr = br;
      }

      if (peakBr > 0.05) {
        // CSS gradient angle = compass bearing of perpDir (CW from up).
        let cssAngle = Math.atan2(perpX, -perpY) * 180 / Math.PI;
        if (cssAngle < 0) cssAngle += 360;

        const stops = samples
          .map((br, s) => `rgba(0,0,0,${br.toFixed(2)}) ${(s * 100 / (GLOW_SAMPLES - 1)).toFixed(0)}%`)
          .join(",");
        maskImage = `linear-gradient(${cssAngle.toFixed(1)}deg, ${stops})`;
      }
    }

    // Stroke carries the visible outline (interior fill is transparent via
    // .name-line CSS). When the mask is active, the stroke is painted at
    // full alpha and the mask attenuates per-position so the outline fades
    // in and out angled across the glyph; without it (fallback path), stroke
    // alpha tracks peakBr directly.
    const strokeAlpha = maskImage ? 1 : peakBr;

    return (
      <span
        key={i}
        ref={el => { refs.current[i] = el; }}
        style={{
          WebkitTextStroke: `1px rgba(29,255,111,${strokeAlpha.toFixed(2)})`,
          WebkitMaskImage: maskImage || undefined,
          maskImage:       maskImage || undefined,
        }}
      >
        {ch}
      </span>
    );
  });
}


// =============================================================================
// MainContent
// Props: angle (radians), hidden (bool), onNav (fn)
// =============================================================================
function MainContent({ angle, hidden, onNav }) {
  // Phosphor glow when sweep passes each button's angular position.
  // Buttons use offset angles so each one lights up at a slightly different time.
  const contactsBr = sweepBrightness(angle,  Math.PI / 2 - 1); // hits first (right)
  const portfolioBr= sweepBrightness(angle,  Math.PI / 2);       // hits second (center)
  const resumeBr   = sweepBrightness(angle,  Math.PI / 2 + 1); // hits third (left)

  return (
    <div
      className="main-content"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      {/* ── TOP HALF ── */}
      <div className="main-top">

        <div className="name-block">

          <div className="name-line">
            <GlowLetters text="GUNYOUNG" baseAngle={-Math.PI / 2} angle={angle} />
          </div>

          <div className="name-line">
            <GlowLetters text="PARK" baseAngle={-Math.PI / 2} angle={angle} />
          </div>

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
          <NavButton glow={contactsBr}  onClick={() => onNav("contacts")}>
            ✉ CONTACTS
          </NavButton>
          {/* ALBUM button hidden until the album holds real photos. */}
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
function SectionResume({ isActive }) {
  const inView = useActiveReveal(isActive);

  const skillGroups = [
    {
      title: "Systems",
      color: C.green,
      skills: ["Java", "C / C++", "Linux", "Git", "Docker", "VS Code", "IntelliJ"],
    },
    {
      title: "Networks",
      color: C.amber,
      skills: ["TCP/IP", "SSH", "Cisco Routers/Switches", "SQL"],
    },
    {
      title: "Software",
      color: C.cyan,
      skills: ["Python", "JavaScript", "React", "Node.js", "Flask", "R", "HTML/CSS", "pandas", "NumPy", "Matplotlib"],
    },
  ];

  const timeline = [
    {
      period:   "Expected May 2028",
      role:     "B.S. Computer Science",
      org:      "Purdue University // West Lafayette, IN",
      desc:     "Pursuing a Bachelor's degree in Computer Science.",
      dotColor: C.green,
    },
    {
      period:   "Sept 2024 – June 2026",
      role:     "Communications & Network Engineer",
      org:      "Republic of Korea Navy // ROKS Cheongju, Pyeongtaek, Korea",
      desc:     "Administered network infrastructure of 5 servers and 80 nodes for 250+ users across 20 months with 99.97% uptime without vendor support. Reduced false-positive IDS alerts by 50% with the fleet's cybersecurity team. Operated tactical and satellite communication systems supporting ship-wide data & voice link. Built an offline HTML & CSS site to track shipmates' onboard status.",
      dotColor: C.amber,
    },
    {
      period:   "Jan 2024 – May 2024",
      role:     "Data Scientist/Engineer",
      org:      "ThermoFisher Scientific @ Purdue Data Mine // West Lafayette, IN",
      desc:     "Forecasted weekly SKU demand with linear regression over 8 months of shipment history, cutting required storage footprint by 14%. Consolidated 500K+ shipment records into a normalized SQLite schema, reducing typical query time from ~3 minutes to under 5 seconds. Raised usable record completeness from 83% to 99%.",
      dotColor: C.green,
    },
    {
      period:   "Sept 2023 – Dec 2023",
      role:     "Data Engineer",
      org:      "Webee @ Purdue Data Mine // West Lafayette, IN",
      desc:     "Joined 120K+ sensor readings to 50 stoppage events to construct labeled pre-fault windows, enabling supervised fault prediction on previously unlabeled data. Built a Flask API and React dashboard visualizing predicted fault probability over live sensor traces.",
      dotColor: C.amber,
    },
    {
      period:   "Aug 2021 – Aug 2023",
      role:     "Teacher & Website Developer",
      org:      "Webee @ Purdue Data Mine // West Lafayette, IN",
      desc:     "Taught coding, engineering, mathematics, and art & technology for 45+ students each summer. Proposed and built a website to aid students and faculty, reducing daily inquiries.",
      dotColor: C.green,
    },
    {
      period:   "Sept 2023 – May 2024",
      role:     "Student Cook",
      org:      "Purdue Dining & Culinary // West Lafayette, IN",
      desc:     "Prepared and served food for hundreds of students at Hillenbrand Dining Court.",
      dotColor: C.amber,
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
                <div className="skill-tags">
                  {group.skills.map((label, si) => (
                    <span
                      key={label}
                      className="skill-tag"
                      style={{
                        borderColor: `${group.color}44`,
                        color:       group.color,
                        opacity:     inView ? 1 : 0,
                        transform:   inView ? "translateY(0)" : "translateY(4px)",
                        transition:  `opacity 0.5s ease ${gi * 0.15 + si * 0.04}s, transform 0.5s ease ${gi * 0.15 + si * 0.04}s`,
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </div>
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
function SectionPortfolio({ isActive }) {
  const inView = useActiveReveal(isActive);

  const projects = [
    {
      freq:     "AUG 2026 – PRESENT // P-01",
      name:     "Personal Server",
      desc:     "Converted a desktop into a personal server linking data across my devices. Rewriting the server in Rust with a VMM that boots a Linux kernel; next up is XDP load balancing and eBPF safety.",
      tags:     ["TCP/IP", "HTTP", "Linux", "Tailscale"],
      featured: [0, 2],
    },
    {
      freq:     "JUN 2023 – AUG 2023 // P-02",
      name:     "Personal Library",
      desc:     "Full-stack web application with Flask serving a REST API and an HTML frontend. Users build their own library with author and genre filtering.",
      tags:     ["Python", "Flask", "SQLite", "HTML/CSS"],
      featured: [0, 1],
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
  // Cards only become links once the project has a real URL to point at.
  const Tag = proj.link ? "a" : "div";

  return (
    <Tag
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
    </Tag>
  );
}


// =============================================================================
// SectionContacts
// =============================================================================
function SectionContacts({ isActive }) {
  const inView = useActiveReveal(isActive);

  // Placeholder values — deliberately non-real until Gunyoung supplies his own.
  // 555-01xx is the reserved fictional US phone range.
  const contacts = [
    { label: "NAME",     value: "Gunyoung Park" },
    { label: "EMAIL",    value: "sample@example.com",              href: "mailto:sample@example.com" },
    { label: "PHONE",    value: "+1 (555) 010-0000",               href: "tel:+15550100000" },
    { label: "LINKEDIN", value: "linkedin.com/in/your-handle",     href: "https://www.linkedin.com/in/your-handle", external: true },
    { label: "GITHUB",   value: "github.com/your-handle",          href: "https://github.com/your-handle",          external: true },
  ];

  return (
    <div
      className="section-panel"
      style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
    >
      <div className="section-inner">
        <SectionDivider channel="CH-06" label="UPLINK // CONTACTS" />

        <div className="contact-panel">
          {contacts.map((item, i) => {
            // Rows only become links when there is somewhere to go.
            const Tag = item.href ? "a" : "div";

            return (
              <div
                key={item.label}
                className="contact-row"
                style={{
                  opacity:    inView ? 1 : 0,
                  transform:  inView ? "translateY(0)" : "translateY(8px)",
                  transition: `opacity 0.6s ease ${i * 0.08}s, transform 0.6s ease ${i * 0.08}s`,
                }}
              >
                <span className="contact-label">{item.label}</span>
                <Tag
                  href={item.href}
                  {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={`contact-value${item.href ? " contact-value--link" : ""}`}
                >
                  {item.value}
                </Tag>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// =============================================================================
// SectionAlbum
// =============================================================================
function SectionAlbum({ isActive }) {
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
  const [angle,            setAngle]            = useState(SWEEP_START);
  const [done,             setDone]             = useState(false);
  const [topBarVis,        setTopBarVis]        = useState(false);
  const [currentSection,   setCurrentSection]   = useState(null);
  const [transitionStart,  setTransitionStart]  = useState(null);
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
    const newAngle = SWEEP_START + totalRef.current;
    setAngle(newAngle);

    if (!doneRef.current) {
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

    const startAngle = SWEEP_START + totalRef.current;
    transitionStartRef.current = startAngle;
    pendingRef.current = section;
    setTransitionStart(startAngle);
  }, []);

  // ── Mask wedge for the radar canvas ──
  // The wedge runs from maskFrom CLOCKWISE to maskTo. Span is always 0 … 2π
  // so the leading edge of the mask coincides with the sweep line.
  let maskFrom = null;
  let maskTo   = null;
  if (!done) {
    // Intro: mask covers the un-swept side. Its leading edge IS the sweep.
    const introMaskTo = SWEEP_START + TWO_PI;
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
          <SectionResume    isActive={currentSection === "resume"}    />
          <SectionPortfolio isActive={currentSection === "portfolio"} />
          <SectionContacts  isActive={currentSection === "contacts"}  />
          {/* SectionAlbum is kept but unmounted until it holds real photos —
              an opacity-0 panel would still be read out by screen readers.
              Restore this line and the ALBUM nav entries to bring it back. */}
        </>
      )}
    </div>
  );
}
