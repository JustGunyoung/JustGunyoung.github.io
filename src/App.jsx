// ─────────────────────────────────────────────────────────────────────────────
// sigint-landing.jsx
//
// SIGINT-themed personal landing page for Gunyoung Park.
//
// Architecture overview:
//   App                  — root; owns the animation loop & global state
//   ├── GridBg           — static phosphor grid background (CSS only)
//   ├── Scanlines        — CRT horizontal scanline overlay (CSS only)
//   ├── Vignette         — radial darkening at screen edges (CSS only)
//   ├── TopBar           — fixed header with live UTC clock
//   ├── MainContent      — name + buttons, revealed progressively by the radar
//   │   ├── NavButton    — individual CTA button with hover state
//   │   ├── Cursor       — blinking terminal cursor after the name
//   │   └── PulseDot     — animated green status dot
//   ├── RadarCanvas      — full-screen radar that sweeps and unmasks content
//   ├── MiniRadarCorner  — small persistent radar shown after intro finishes
//   ├── StatusBar        — bottom fixed bar with live system readouts
//   ├── SectionResume    — #resume: experience timeline + skills
//   ├── SectionPortfolio — #portfolio: project cards grid
//   └── SectionAlbum     — #album: photo / media gallery placeholder
//
// Reveal mechanic:
//   The radar starts at 12 o'clock (−π/2 radians) and sweeps clockwise.
//   A solid black sector fills the un-swept portion of the screen, hiding
//   the content below. As the sweep advances, `revealed` (0→1) tracks how
//   much of the first full rotation is complete. Once `revealed` crosses
//   thresholds (0.18, 0.3, 0.72), UI elements fade/slide in behind the mask.
//   After TOTAL_SPIN radians the big radar unmounts and MiniRadarCorner takes over.
//
// Page structure (post-intro):
//   The root <div> becomes scrollable once `done` is true. The landing section
//   is 100vh, followed by Resume, Portfolio, and Album sections below it.
//   The TopBar nav buttons use anchor hrefs which browser-scroll to each section.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Animation constants ───────────────────────────────────────────────────
const TWO_PI      = Math.PI * 2;
const TRAIL_ANGLE = Math.PI * 0.55; // radians: how long the green afterglow trail is
const RPM         = 0.38;           // rotations per second (sweep speed)
const TOTAL_SPIN  = TWO_PI * 1.6;   // total radians before intro ends (~1.6 full circles)

// ─── Design tokens ────────────────────────────────────────────────────────
// All colours live here so tweaking the palette is a single-location change.
const C = {
  bg:       "#07090C", // near-black page background
  panel:    "#0D1117", // slightly lighter panel surfaces
  border:   "#1A2A1A", // dark green-tinted borders
  green:    "#1DFF6F", // primary phosphor green (sweep line, accents)
  greenDim: "#0A4020", // muted green for subtle borders/badges
  amber:    "#FFB300", // amber accent (brackets, topbar logo)
  amberDim: "#7A5500", // dim amber for less prominent elements
  cyan:     "#00E5FF", // cyan (reserved for future data panels)
  text:     "#C8D0C8", // main body text
  textDim:  "#3A4A3A", // secondary / dimmed text
};

// ─── Utility functions ────────────────────────────────────────────────────
// Linear interpolation between a and b by factor t (0–1).
const lerp  = (a, b, t) => a + (b - a) * t;
// Clamps v to the inclusive range [lo, hi].
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));


// =============================================================================
// RadarCanvas
//
// Renders the full-viewport radar animation onto an HTML5 canvas.
// Redraws every time `angle` or `revealed` changes (driven by the rAF loop
// in App). Does NOT run its own animation loop — it is a pure paint step.
//
// Props:
//   angle    — current sweep angle in radians (starts at -π/2, increases CW)
//   revealed — fraction of first full rotation completed (0 → 1)
// =============================================================================
function RadarCanvas({ angle, revealed }) {
  // We keep a ref to the canvas DOM node so we can call getContext("2d").
  const ref = useRef(null);

  // Re-run the entire draw routine whenever angle or revealed changes.
  // Because rAF drives ~60 updates/sec, this effectively animates smoothly.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // Canvas logical resolution matches the browser viewport pixel size.
    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2; // horizontal centre
    const cy = H / 2; // vertical centre

    // R is the sweep radius. We make it slightly larger than the viewport
    // diagonal so the sweep line always reaches the corners without gaps.
    const R  = Math.hypot(cx, cy) * 1.05;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H); // wipe previous frame before repainting

    // ── Step 1: CONCENTRIC GRID RINGS ──────────────────────────────────────
    // Five evenly-spaced rings give the canvas its radar scope look.
    ctx.save();
    ctx.strokeStyle = C.border;
    ctx.lineWidth   = 0.5;
    for (let r = R / 5; r <= R; r += R / 5) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.stroke();
    }
    // Horizontal + vertical crosshairs through the centre point.
    ctx.beginPath();
    ctx.moveTo(0,  cy); ctx.lineTo(W,  cy); // horizontal
    ctx.moveTo(cx,  0); ctx.lineTo(cx,  H); // vertical
    ctx.stroke();
    ctx.restore();

    // ── Step 2: SWEEP TRAIL (phosphor afterglow) ───────────────────────────
    // We approximate a radial gradient by drawing 60 thin filled arc segments
    // from the trailing edge to the sweep tip, each slightly more opaque.
    // This sidesteps createConicalGradient which isn't universally supported.
    const trailStart = angle - TRAIL_ANGLE; // angle where the glow fades to 0
    const STEPS = 60;
    for (let i = 0; i < STEPS; i++) {
      const t  = i / STEPS;                                   // 0 at tail, 1 at tip
      const a0 = lerp(trailStart, angle, t);                  // segment start
      const a1 = lerp(trailStart, angle, (i + 1) / STEPS);   // segment end
      const alpha = t * 0.22;                                 // opacity ramps 0 → 0.22

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = `rgba(29,255,111,${alpha})`;
      ctx.fill();
      ctx.restore();
    }

    // ── Step 3: SWEEP LINE ─────────────────────────────────────────────────
    // The bright leading edge of the sweep — a glowing green radius line.
    ctx.save();
    ctx.strokeStyle = C.green;
    ctx.lineWidth   = 2;
    ctx.shadowColor = C.green;
    ctx.shadowBlur  = 14; // soft phosphor glow around the line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
    ctx.stroke();
    ctx.restore();

    // ── Step 4: BLACK MASK (hides un-swept content) ────────────────────────
    // `revealed` is the fraction of the first full rotation already swept.
    // Converting it to radians gives the angular extent of the revealed sector.
    //
    // The sweep starts at −π/2 (12 o'clock) and goes clockwise, so:
    //   - The swept sector spans from −π/2 to (−π/2 + revealedAngle).
    //   - The un-swept sector (the black mask) spans the rest of the circle.
    const revealedAngle = clamp(revealed, 0, 1) * TWO_PI;

    // maskStart is where the black sector begins (= end of the revealed sector).
    const maskStart = -Math.PI / 2 + revealedAngle;

    if (revealedAngle < TWO_PI) {
      // Only draw the mask until the first full rotation is complete.
      // At revealed === 1 the mask would be zero-width and is redundant.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      // Arc from maskStart back to 12 o'clock (= −π/2 + 2π).
      // R * 1.2 ensures the mask covers beyond the screen edges too.
      ctx.arc(cx, cy, R * 1.2, maskStart, -Math.PI / 2 + TWO_PI);
      ctx.closePath();
      ctx.fillStyle = C.bg; // exactly matches the page background — seamless
      ctx.fill();
      ctx.restore();
    }

    // ── Step 5: RADAR BLIPS ────────────────────────────────────────────────
    // Five contact dots scattered around the screen.
    // Each blip becomes visible only after the sweep has passed its position.
    // Brightness decays as the sweep moves further away (simulating phosphor fade).
    const blips = [
      { angle: -0.6, r: R * 0.28 }, // upper-left
      { angle:  1.1, r: R * 0.45 }, // right
      { angle:  2.8, r: R * 0.35 }, // lower
      { angle:  4.4, r: R * 0.55 }, // left
      { angle:  5.5, r: R * 0.30 }, // upper-right
    ];

    blips.forEach(b => {
      // Normalise the blip angle into [0, 2π] relative to 12 o'clock,
      // matching the coordinate space of `revealedAngle`.
      const normalised = ((b.angle + Math.PI / 2) % TWO_PI + TWO_PI) % TWO_PI;

      // Skip if the sweep hasn't reached this blip yet (still under the mask).
      if (normalised > revealedAngle) return;

      // da = angular distance from the current sweep tip back to this blip.
      //  0  → sweep just passed it  (maximum brightness)
      //  2π → sweep is a full lap away (minimum brightness)
      const da = ((angle - b.angle) % TWO_PI + TWO_PI) % TWO_PI;

      // Brightness decays to zero at da = 0.7π.
      // Exponent 1.5 gives a faster initial drop-off (more physical).
      const brightness = Math.pow(Math.max(0, 1 - da / (Math.PI * 0.7)), 1.5);
      if (brightness < 0.03) return; // skip barely-visible blips

      const bx = cx + Math.cos(b.angle) * b.r;
      const by = cy + Math.sin(b.angle) * b.r;

      ctx.save();
      ctx.fillStyle   = `rgba(29,255,111,${0.2 + brightness * 0.8})`;
      ctx.shadowColor = C.green;
      ctx.shadowBlur  = 10 * brightness;         // glow scales with brightness
      ctx.beginPath();
      ctx.arc(bx, by, 3 + brightness * 2, 0, TWO_PI); // dot grows when freshly hit
      ctx.fill();
      ctx.restore();
    });

    // ── Step 6: OUTER BORDER RING ──────────────────────────────────────────
    // A clean circular stroke that frames the entire radar scope area.
    ctx.save();
    ctx.strokeStyle = "#1A3A1A";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();

  }, [angle, revealed]); // dependency array: redraw whenever these props change

  return (
    // z-index 20 puts this above the content (z 10) and grid (z 0),
    // but below vignette (40), scanlines (50), and topbar (60).
    // pointer-events: none lets clicks pass through to the buttons underneath.
    <canvas
      ref={ref}
      width={window.innerWidth}
      height={window.innerHeight}
      style={{
        position:      "fixed",
        inset:         0,
        pointerEvents: "none",
        zIndex:        20,
      }}
    />
  );
}


// =============================================================================
// Scanlines
//
// A CSS repeating-gradient that simulates CRT monitor horizontal scanlines.
// Purely decorative — the 2px green tint every 4px is very subtle (opacity
// 0.025) but gives the screen an authentic phosphor-monitor texture.
// Sits at z-index 50, above everything except the topbar.
// =============================================================================
function Scanlines() {
  return (
    <div style={{
      position:      "fixed",
      inset:         0,
      // Pattern: 2px transparent + 2px faint green, repeating every 4px
      background:    "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,80,0.025) 2px,rgba(0,255,80,0.025) 4px)",
      pointerEvents: "none",
      zIndex:        50,
    }} />
  );
}


// =============================================================================
// Vignette
//
// A radial gradient that darkens screen corners, drawing the eye toward the
// centre where the name and buttons are. Also softens the hard edges where
// the radar sweep runs off-screen.
// =============================================================================
function Vignette() {
  return (
    <div style={{
      position:      "fixed",
      inset:         0,
      background:    "radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.75) 100%)",
      pointerEvents: "none",
      zIndex:        40,
    }} />
  );
}


// =============================================================================
// GridBg
//
// Subtle phosphor grid rendered with two overlapping CSS linear-gradients
// (one horizontal, one vertical). Each line is 4% opacity green so it adds
// atmosphere without competing with the radar animation.
// Sits at z-index 0 — the lowest layer.
// =============================================================================
function GridBg() {
  return (
    <div style={{
      position:      "fixed",
      inset:         0,
      backgroundImage: `
        linear-gradient(rgba(29,255,111,0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(29,255,111,0.04) 1px, transparent 1px)
      `,
      backgroundSize: "48px 48px",
      pointerEvents:  "none",
      zIndex:         0,
    }} />
  );
}


// =============================================================================
// TopBar
//
// Fixed header strip with the station callsign on the left and a live UTC
// clock + coordinates on the right.
//
// Fades in via opacity transition once the radar sweep has cleared ~15% of
// the screen (controlled by the `visible` prop from App).
//
// Props:
//   visible — boolean; when false the bar is transparent (opacity 0)
// =============================================================================
function TopBar({ visible }) {
  // UTC time string, rebuilt every second.
  const [utc, setUtc] = useState("");

  useEffect(() => {
    const fmt = () => {
      const n = new Date();
      const p = v => String(v).padStart(2, "0"); // zero-pad: 9 → "09"
      setUtc(`${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())} UTC`);
    };
    fmt(); // run immediately so there's no blank flash on mount
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id); // cancel interval on component unmount
  }, []);

  // Nav links shown in the topbar after the intro. Each scrolls to a section.
  const navLinks = [
    { label: "RESUME",    href: "#resume"    },
    { label: "PORTFOLIO", href: "#portfolio" },
    { label: "ALBUM",     href: "#album"     },
  ];

  return (
    <div style={{
      position:       "fixed",
      top: 0, left: 0, right: 0,
      height:         44,
      background:     "rgba(7,9,12,0.92)",    // semi-transparent: grid shows through
      borderBottom:   `1px solid ${C.border}`,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      padding:        "0 24px",
      zIndex:         60, // topmost layer — always above everything
      opacity:        visible ? 1 : 0,
      // 0.2s delay prevents the bar from flashing on the very first rAF frame
      transition:     "opacity 0.8s ease 0.2s",
      fontFamily:     "'IBM Plex Mono', monospace",
      fontSize:       11,
    }}>
      {/* Left: station callsign + nav links (nav links appear alongside after intro) */}
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <span style={{ color: C.amber, letterSpacing: "0.18em" }}>
          ◈ SIGINT // STATION-01
        </span>

        {/* Section nav links — only visible once topbar is visible */}
        <nav style={{ display: "flex", gap: 4 }}>
          {navLinks.map(link => (
            <TopBarNavLink key={link.href} href={link.href}>
              {link.label}
            </TopBarNavLink>
          ))}
        </nav>
      </div>

      {/* Right: live UTC clock + static coordinates */}
      <span style={{ color: C.textDim }}>
        <span style={{ color: C.green, marginRight: 12 }}>{utc}</span>
        LAT 40.4259° N · LON 86.9081° W
      </span>
    </div>
  );
}


// =============================================================================
// TopBarNavLink
//
// A minimal anchor used inside the TopBar nav. Highlights in green on hover.
// Thin and understated so it doesn't compete with the station callsign.
// =============================================================================
function TopBarNavLink({ href, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily:    "'IBM Plex Mono', monospace",
        fontSize:      10,
        letterSpacing: "0.12em",
        color:         hovered ? C.green : C.textDim,
        textDecoration: "none",
        padding:       "4px 10px",
        borderRadius:  2,
        background:    hovered ? "rgba(29,255,111,0.06)" : "transparent",
        transition:    "color 0.15s, background 0.15s",
      }}
    >
      {children}
    </a>
  );
}
// A monospace anchor tag styled to look like a terminal command input.
// The border and text colour react instantly on hover for snappy feedback,
// while the entrance animation (opacity + translateY) uses a stagger delay
// so the three buttons appear to materialise one after the other.
//
// Props:
//   children — button label (string or JSX)
//   href     — anchor href destination
//   delay    — entrance transition-delay in seconds (for stagger effect)
//   visible  — boolean; false = transparent & shifted 10px down
// =============================================================================
function NavButton({ children, href, delay, visible }) {
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href={href || "#"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            10,
        padding:        "14px 36px",
        // Border switches instantly on hover (delay 0s) for crisp interaction
        border:         `1px solid ${hovered ? C.green : "#1A3A1A"}`,
        borderRadius:   3,
        background:     hovered ? "rgba(29,255,111,0.07)" : "rgba(13,17,23,0.85)",
        color:          hovered ? C.green : C.text,
        fontFamily:     "'IBM Plex Mono', monospace",
        fontSize:       13,
        fontWeight:     500,
        letterSpacing:  "0.15em",
        textDecoration: "none",
        cursor:         "pointer",
        backdropFilter: "blur(4px)", // slight glass effect behind the button
        // Entrance: opacity + transform use the stagger delay
        // Hover:    border/bg/color changes have no delay for instant feedback
        opacity:               visible ? 1 : 0,
        transform:             visible ? "translateY(0)" : "translateY(10px)",
        transitionProperty:    "opacity, transform, border-color, background, color",
        transitionDuration:    "0.6s, 0.6s, 0.2s, 0.2s, 0.2s",
        transitionDelay:       `${delay}s, ${delay}s, 0s, 0s, 0s`,
        minWidth:       160,
        justifyContent: "center",
      }}
    >
      {children}
    </a>
  );
}


// =============================================================================
// MainContent
//
// The full-screen layer that sits directly behind the radar canvas (z-index 10).
// It is always rendered; the radar's black mask sector is what hides it until
// the sweep has passed each area.
//
// Once `revealed` crosses a threshold, a CSS opacity/transform transition
// makes the corresponding element appear to "materialise" from behind the mask.
//
// Layout (two equal flex halves split by a horizontal divider):
//   TOP HALF    — "SIGNAL ACQUIRED" tag + GUNYOUNG PARK name block
//   DIVIDER     — thin fading horizontal rule
//   BOTTOM HALF — RESUME / PORTFOLIO / ALBUM buttons + internship badge
//
// Props:
//   revealed — 0→1 fraction of the first radar rotation
// =============================================================================
function MainContent({ revealed }) {
  // Each threshold is tuned so the element appears just after the sweep clears it.
  const tagVisible  = revealed > 0.18; // frequency tag above the name
  const topVisible  = revealed > 0.30; // name block (top half of screen)
  const btnsVisible = revealed > 0.72; // buttons + badge (bottom half)

  return (
    <div style={{
      position:       "fixed",
      inset:          0,
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
      zIndex:         10, // above grid bg (0), below radar canvas (20)
      paddingTop:     44, // clear the fixed 44px topbar
    }}>

      {/* ── TOP HALF ──────────────────────────────────────────────────────── */}
      <div style={{
        flex:           1,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "flex-end", // anchor content toward the divider
        paddingBottom:  36,
        width:          "100%",
      }}>

        {/* Frequency / status tag — first item to appear (threshold 0.18) */}
        <div style={{
          fontFamily:   "'IBM Plex Mono', monospace",
          fontSize:     10,
          letterSpacing: "0.28em",
          color:        C.green,
          marginBottom: 18,
          opacity:      tagVisible ? 1 : 0,
          transform:    tagVisible ? "translateY(0)" : "translateY(8px)",
          transition:   "opacity 0.7s ease, transform 0.7s ease",
        }}>
          ▸ SIGNAL ACQUIRED · DECRYPTING IDENTITY
        </div>

        {/* Name block — two lines, each with a slightly different delay so
            they cascade in rather than appearing simultaneously */}
        <div style={{
          fontFamily:  "'IBM Plex Mono', monospace",
          fontWeight:  600,
          lineHeight:  1.0,
          textAlign:   "center",
        }}>

          {/* First name: GUNYOUNG */}
          <div style={{
            fontSize:     "clamp(52px, 9vw, 120px)",
            color:        "#E8F0E8",
            letterSpacing: "-0.02em",
            opacity:      topVisible ? 1 : 0,
            transform:    topVisible ? "translateY(0)" : "translateY(16px)",
            // 0.1s delay — appears slightly before the last name
            transition:   "opacity 0.9s ease 0.1s, transform 0.9s ease 0.1s",
          }}>
            {/* Amber brackets are a recurring SIGINT visual motif */}
            <span style={{ color: C.amber }}>[</span>
            GUNYOUNG
            <span style={{ color: C.amber }}>]</span>
          </div>

          {/* Last name: PARK — 0.15s after the first name */}
          <div style={{
            fontSize:     "clamp(52px, 9vw, 120px)",
            color:        "#E8F0E8",
            letterSpacing: "-0.02em",
            opacity:      topVisible ? 1 : 0,
            transform:    topVisible ? "translateY(0)" : "translateY(16px)",
            // 0.25s delay — cascades in after GUNYOUNG
            transition:   "opacity 0.9s ease 0.25s, transform 0.9s ease 0.25s",
          }}>
            <span style={{ color: C.amber }}>[</span>
            PARK
            <span style={{ color: C.amber }}>]</span>
            {/* Blinking block cursor sits at the end of the last name line */}
            <Cursor />
          </div>
        </div>

        {/* Sub-title: role and affiliation, 0.5s after topVisible flips */}
        <div style={{
          fontFamily:    "'IBM Plex Mono', monospace",
          fontSize:      13,
          color:         C.textDim,
          letterSpacing: "0.12em",
          marginTop:     18,
          opacity:       topVisible ? 1 : 0,
          transition:    "opacity 1s ease 0.5s",
        }}>
          ROK NAVY · COMMS &amp; NETWORK ENG · PURDUE CS
        </div>

      </div>

      {/* ── HORIZONTAL DIVIDER ────────────────────────────────────────────── */}
      {/* Fades in with the name block. The gradient edges make it feel
          integrated rather than like a hard rule slapped across the page. */}
      <div style={{
        width:      "min(640px, 80vw)",
        height:     1,
        background: `linear-gradient(90deg, transparent, ${C.border}, transparent)`,
        opacity:    topVisible ? 1 : 0,
        transition: "opacity 0.8s ease 0.4s",
      }} />

      {/* ── BOTTOM HALF ───────────────────────────────────────────────────── */}
      <div style={{
        flex:           1,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "flex-start", // anchor content toward the divider
        paddingTop:     36,
        width:          "100%",
        gap:            20,
      }}>

        {/* Three CTA buttons with staggered delay values:
            RESUME (0s) → PORTFOLIO (0.12s) → ALBUM (0.24s) */}
        <div style={{
          display:        "flex",
          gap:            16,
          flexWrap:       "wrap",
          justifyContent: "center",
        }}>
          <NavButton href="#resume"    delay={0.00} visible={btnsVisible}>
            ↓ RESUME
          </NavButton>
          <NavButton href="#portfolio" delay={0.12} visible={btnsVisible}>
            ⌥ PORTFOLIO
          </NavButton>
          <NavButton href="#album"     delay={0.24} visible={btnsVisible}>
            ◈ ALBUM
          </NavButton>
        </div>

        {/* Status badge — last element to appear (0.6s after btnsVisible flips).
            The PulseDot suggests an active live signal. */}
        <div style={{
          fontFamily:    "'IBM Plex Mono', monospace",
          fontSize:      11,
          color:         C.green,
          border:        `1px solid ${C.greenDim}`,
          padding:       "6px 18px",
          borderRadius:  3,
          letterSpacing: "0.12em",
          opacity:       btnsVisible ? 1 : 0,
          transition:    "opacity 0.8s ease 0.6s",
          marginTop:     8,
          display:       "flex",
          alignItems:    "center",
          gap:           8,
        }}>
          <PulseDot />
          SEEKING INTERNSHIP 2025
        </div>

      </div>
    </div>
  );
}


// =============================================================================
// Cursor
//
// A blinking vertical block cursor that appears at the end of "PARK".
// Toggles visibility every 530ms — close to a real terminal's ~500ms blink.
// Width is expressed in `em` units so it scales with the giant name font size.
// =============================================================================
function Cursor() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setOn(v => !v), 530);
    return () => clearInterval(id); // prevent memory leak on unmount
  }, []);

  return (
    <span style={{
      display:       "inline-block",
      width:         "0.07em",   // thin bar proportional to parent font size
      height:        "0.85em",   // slightly shorter than full cap height
      background:    on ? C.green : "transparent",
      marginLeft:    6,
      verticalAlign: "middle",
      transition:    "background 0.1s", // softens the on/off switch slightly
    }} />
  );
}


// =============================================================================
// PulseDot
//
// A small green circle that pulses with a CSS keyframe animation.
// Used inside the "SEEKING INTERNSHIP" badge to suggest a live active signal.
// The @keyframes rule is injected via App's inline <style> block.
// =============================================================================
function PulseDot() {
  return (
    <span style={{
      display:      "inline-block",
      width:        6,
      height:       6,
      borderRadius: "50%",
      background:   C.green,
      boxShadow:    `0 0 6px ${C.green}`,
      animation:    "pulse 2s ease-in-out infinite", // defined in App's <style>
    }} />
  );
}


// =============================================================================
// App  (root component / application entry point)
//
// Owns all global state and runs the single requestAnimationFrame loop that
// powers the radar sweep intro sequence.
//
// State:
//   angle     — current sweep angle (radians); passed down to RadarCanvas
//   revealed  — 0→1 fraction of the first full rotation; drives mask + content
//   done      — true when TOTAL_SPIN is reached; swaps big radar for mini one
//   topBarVis — true once sweep has passed ~15% of the top area
//
// Refs (mutated each frame without triggering re-renders where possible):
//   rafRef      — requestAnimationFrame handle, used for cleanup on unmount
//   lastTimeRef — previous rAF timestamp, used to compute frame delta time
//   totalRef    — cumulative radians rotated, compared against TOTAL_SPIN
// =============================================================================
export default function App() {
  // The sweep angle is stored in state so RadarCanvas re-renders each frame.
  // Starting at −π/2 puts the line at 12 o'clock (straight up).
  const [angle,     setAngle]     = useState(-Math.PI / 2);

  // 0 = nothing revealed yet; 1 = first full rotation complete, mask is gone.
  const [revealed,  setRevealed]  = useState(0);

  // Flips to true when the intro animation finishes. Big radar unmounts,
  // MiniRadarCorner mounts, and the page becomes scrollable.
  const [done,      setDone]      = useState(false);

  // Topbar fades in early — once the sweep has cleared the top of the screen —
  // so it doesn't flash on before any content is visible.
  const [topBarVis, setTopBarVis] = useState(false);

  const rafRef      = useRef(null); // stores rAF ID so we can cancel it on unmount
  const lastTimeRef = useRef(null); // DOMHighResTimeStamp of the previous frame
  const totalRef    = useRef(0);    // cumulative radians turned so far

  // animate() is called once per frame by requestAnimationFrame.
  // useCallback with an empty dep array keeps the reference stable across
  // re-renders, which is required for the useEffect below to work correctly.
  const animate = useCallback((ts) => {
    // On the first ever frame, seed lastTimeRef to avoid a huge initial dt.
    if (lastTimeRef.current === null) lastTimeRef.current = ts;

    // Delta time in seconds. Clamped to 50ms to prevent the sweep from
    // jumping wildly if the browser tab was hidden (pausing rAF).
    const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05);
    lastTimeRef.current = ts;

    // Convert RPM to radians for this frame: rotations/sec × 2π × seconds.
    const dAngle = RPM * TWO_PI * dt;
    totalRef.current += dAngle; // accumulate total rotation

    // Update the sweep angle (triggers RadarCanvas repaint via useEffect).
    setAngle(a => a + dAngle);

    // `revealed` tracks only the first full rotation (0 → 1).
    // After one full lap the mask disappears and this value stays at 1.
    setRevealed(clamp(totalRef.current / TWO_PI, 0, 1));

    // Check if the full intro sequence is complete.
    if (totalRef.current >= TOTAL_SPIN) {
      setDone(true);       // unmounts big radar, mounts MiniRadarCorner
      setTopBarVis(true);  // ensure topbar is definitely visible
      return;              // do NOT schedule another frame — animation is over
    }

    // Show the topbar once the sweep has advanced 15% past 12 o'clock.
    // This ensures it doesn't appear before the radar has swept past the top edge.
    if (totalRef.current > 0.15 * TWO_PI) setTopBarVis(true);

    // Schedule the next animation frame.
    rafRef.current = requestAnimationFrame(animate);
  }, []); // empty deps — animate never closes over changing state

  // Start the rAF loop on mount; clean it up on unmount.
  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  return (
    <div style={{
      background: C.bg,
      minHeight:  "100vh",
      cursor:     "crosshair",   // military/targeting cursor aesthetic
      // During the intro we lock scroll so the radar fills the screen cleanly.
      // Once done, we allow scrolling so the user can reach the content sections.
      overflowY:  done ? "auto" : "hidden",
      overflowX:  "hidden",
      position:   "relative",
    }}>
      {/* ── Global styles ──────────────────────────────────────────────────
          - Google Fonts: IBM Plex Mono (monospace) + DM Sans (body prose)
          - CSS reset
          - scroll-behavior: smooth so anchor links animate instead of jump
          - @keyframes for PulseDot and section fade-in (SectionReveal)
          - Custom scrollbar styled to match the SIGINT palette
      ─────────────────────────────────────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #1DFF6F; }
          50%       { opacity: 0.35; box-shadow: none; }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #07090C; }
        ::-webkit-scrollbar-thumb { background: #1A2A1A; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #1DFF6F44; }
      `}</style>

      {/* ── Always-present atmospheric layers ── */}
      {/* z-index 0  — phosphor grid (lowest layer, pure atmosphere) */}
      <GridBg />
      {/* z-index 40 — radial vignette (above radar for edge polish) */}
      <Vignette />
      {/* z-index 50 — CRT scanlines (second-to-top decorative layer) */}
      <Scanlines />

      {/* ── Fixed chrome ── */}
      {/* z-index 60 — topbar, always above everything */}
      <TopBar visible={topBarVis} />
      {/* z-index 55 — status bar at the bottom, shown after intro */}
      {done && <StatusBar />}

      {/* ── Landing section (100vh, the intro canvas lives here) ── */}
      {/* id="landing" is the implicit home; no nav link needed */}
      <section id="landing" style={{ position: "relative", height: "100vh" }}>
        {/* z-index 10 — name + buttons, revealed by the radar sweep */}
        <MainContent revealed={revealed} />

        {/* z-index 20 — full-screen radar canvas (only during intro) */}
        {!done && <RadarCanvas angle={angle} revealed={revealed} />}

        {/* After intro: small corner radar keeps the aesthetic alive */}
        {done && <MiniRadarCorner />}

        {/* Scroll-down hint arrow — appears after intro, fades on scroll */}
        {done && <ScrollHint />}
      </section>

      {/* ── Content sections (only rendered after intro ends) ──────────────
          Rendering them earlier would cause layout shifts during the animation.
          Each section is a separate component with its own scroll-reveal logic.
      ─────────────────────────────────────────────────────────────────── */}
      {done && (
        <>
          <SectionResume />
          <SectionPortfolio />
          <SectionAlbum />
        </>
      )}
    </div>
  );
}


// =============================================================================
// MiniRadarCorner
//
// A 160×160 px radar shown in the bottom-right corner after the intro ends.
// Runs its own internal requestAnimationFrame loop (App's loop has stopped).
//
// The drawing logic mirrors RadarCanvas but is simplified:
//   - No black mask sector (everything is always visible)
//   - No revealed threshold checks
//   - Just continuous sweep + trail + fading blips
//
// Using a ref for the angle (aRef) instead of state avoids triggering React
// re-renders each frame — we draw directly to the canvas imperatively.
// =============================================================================
function MiniRadarCorner() {
  const ref   = useRef(null);         // canvas DOM element
  const aRef  = useRef(-Math.PI / 2); // current sweep angle, mutated directly
  const rafId = useRef(null);         // rAF handle for cleanup on unmount

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const SIZE = 160;
    canvas.width  = SIZE;
    canvas.height = SIZE;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R  = SIZE / 2 - 4; // 4px inset so the stroke isn't clipped

    const ctx = canvas.getContext("2d");

    // Blip positions for the mini radar (fewer than the full-screen version).
    const blips = [
      { angle: 0.8, r: R * 0.50 },
      { angle: 2.3, r: R * 0.72 },
      { angle: 4.1, r: R * 0.38 },
    ];

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);

      // ── Grid rings ──
      ctx.strokeStyle = C.border;
      ctx.lineWidth   = 0.5;
      for (let r = R / 3; r <= R; r += R / 3) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TWO_PI);
        ctx.stroke();
      }
      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(SIZE, cy);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, SIZE);
      ctx.stroke();

      // ── Sweep trail (40 segments — fewer than full-screen for performance) ──
      for (let i = 0; i < 40; i++) {
        const t  = i / 40;
        const a0 = lerp(aRef.current - TRAIL_ANGLE, aRef.current, t);
        const a1 = lerp(aRef.current - TRAIL_ANGLE, aRef.current, (i + 1) / 40);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = `rgba(29,255,111,${t * 0.18})`;
        ctx.fill();
        ctx.restore();
      }

      // ── Sweep line ──
      ctx.save();
      ctx.strokeStyle = C.green;
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = C.green;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(aRef.current) * R, cy + Math.sin(aRef.current) * R);
      ctx.stroke();
      ctx.restore();

      // ── Blips with exponential brightness decay ──
      blips.forEach(b => {
        // Angular distance from sweep tip to this blip
        const da = ((aRef.current - b.angle) % TWO_PI + TWO_PI) % TWO_PI;
        // Quadratic decay: bright right after the sweep, fades quickly
        const br = Math.pow(Math.max(0, 1 - da / (Math.PI * 0.6)), 2);
        if (br < 0.04) return; // skip nearly invisible blips

        const bx = cx + Math.cos(b.angle) * b.r;
        const by = cy + Math.sin(b.angle) * b.r;
        ctx.save();
        ctx.fillStyle   = `rgba(29,255,111,${0.2 + br * 0.8})`;
        ctx.shadowColor = C.green;
        ctx.shadowBlur  = 6 * br;
        ctx.beginPath();
        ctx.arc(bx, by, 2 + br * 2, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      });

      // ── Outer border ring ──
      ctx.save();
      ctx.strokeStyle = "#1A3A1A";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TWO_PI);
      ctx.stroke();
      ctx.restore();

      // Advance angle by the equivalent of RPM at 60fps.
      // This is an approximation — actual frame rate varies — but for an
      // ambient decorative element the drift is imperceptible.
      aRef.current += RPM * TWO_PI / 60;

      // Schedule the next frame for this mini radar's private loop.
      rafId.current = requestAnimationFrame(draw);
    };

    // Kick off the mini radar's own animation loop.
    rafId.current = requestAnimationFrame(draw);

    // Cleanup: cancel the loop if MiniRadarCorner ever unmounts.
    return () => cancelAnimationFrame(rafId.current);
  }, []); // empty array: run once on mount, never re-run

  return (
    <div style={{
      position:     "fixed",
      bottom:       20,
      right:        20,
      zIndex:       30,        // above content (10) and radar canvas area, below topbar (60)
      opacity:      0.65,      // subtle — shouldn't compete with the main content
      border:       `1px solid ${C.border}`,
      borderRadius: "50%",     // clips the square canvas to a circle visually
    }}>
      <canvas
        ref={ref}
        style={{ display: "block", borderRadius: "50%" }}
      />
    </div>
  );
}


// =============================================================================
// ScrollHint
//
// A small animated chevron shown at the bottom-centre of the landing section
// after the intro finishes. It pulses up and down to suggest scrollability.
// Fades out automatically after the user scrolls past ~80px.
// =============================================================================
function ScrollHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Listen to the window scroll event. Once the user scrolls more than 80px
    // we hide the hint permanently — it has done its job.
    const onScroll = () => {
      if (window.scrollY > 80) setVisible(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{
      position:   "fixed",
      bottom:     32,
      left:       "50%",
      transform:  "translateX(-50%)",
      zIndex:     35,
      display:    "flex",
      flexDirection: "column",
      alignItems: "center",
      gap:        4,
      opacity:    visible ? 1 : 0,
      // Fade out smoothly when the user starts scrolling.
      transition: "opacity 0.5s ease",
      pointerEvents: "none", // never blocks clicks
    }}>
      {/* Label */}
      <span style={{
        fontFamily:    "'IBM Plex Mono', monospace",
        fontSize:      9,
        letterSpacing: "0.25em",
        color:         C.textDim,
        textTransform: "uppercase",
      }}>
        scroll
      </span>

      {/* Bouncing chevron — CSS animation defined inline via keyframes in <style> */}
      <svg
        width="16" height="16" viewBox="0 0 16 16" fill="none"
        style={{ animation: "chevronBounce 1.4s ease-in-out infinite" }}
      >
        <path d="M3 6l5 5 5-5" stroke={C.green} strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* We inject the chevronBounce keyframe here since it's scoped to this component */}
      <style>{`
        @keyframes chevronBounce {
          0%, 100% { transform: translateY(0);   opacity: 0.4; }
          50%       { transform: translateY(5px); opacity: 1;   }
        }
      `}</style>
    </div>
  );
}


// =============================================================================
// StatusBar
//
// A fixed bottom strip (28px tall) that mirrors real terminal status bars.
// Shows live packet count, a mini waveform canvas, uptime, and a mode indicator.
// Only rendered after the intro is complete (`done === true` in App).
//
// The waveform is drawn imperatively on a <canvas> via its own rAF loop,
// the same pattern as MiniRadarCorner. The packet counter increments randomly
// to simulate active network traffic.
// =============================================================================
function StatusBar() {
  const waveRef  = useRef(null);  // canvas for the waveform
  const rafId    = useRef(null);  // rAF handle
  const offsetRef = useRef(0);    // waveform phase offset, mutated each frame

  // Packet counter — increments by a random amount every 200ms.
  const [pkts, setPkts] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setPkts(p => p + Math.floor(Math.random() * 12) + 1);
    }, 200);
    return () => clearInterval(id);
  }, []);

  // Uptime counter — elapsed seconds since the component mounted.
  const [upSec, setUpSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setUpSec(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Format uptime as HH:MM:SS.
  const fmtUptime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = v => String(v).padStart(2, "0");
    return `${p(h)}:${p(m)}:${p(sec)}`;
  };

  // Waveform canvas animation — runs its own rAF loop.
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
        // Composite wave: fundamental + 3rd harmonic + tiny noise.
        const t = (x + offsetRef.current) / 18;
        const y = 9
          + Math.sin(t) * 5
          + Math.sin(t * 2.9) * 2
          + (Math.random() - 0.5) * 0.4; // subtle noise
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      offsetRef.current += 1.8; // advance phase → scrolls the wave rightward
      rafId.current = requestAnimationFrame(draw);
    };

    rafId.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  // Shared style for each key-value pair in the bar.
  const item = (label, value, valueColor = C.green) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: C.textDim }}>{label}</span>
      <span style={{ color: valueColor, fontWeight: 500 }}>{value}</span>
    </div>
  );

  return (
    <div style={{
      position:   "fixed",
      bottom:     0, left: 0, right: 0,
      height:     28,
      background: "rgba(7,9,12,0.95)",
      borderTop:  `1px solid ${C.border}`,
      display:    "flex",
      alignItems: "center",
      padding:    "0 20px",
      gap:        24,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize:   10,
      letterSpacing: "0.05em",
      zIndex:     55, // above content, below topbar (60)
    }}>
      {/* Left cluster: network stats */}
      {item("FREQ",  "156.800 MHz")}
      {item("MODE",  "USB")}
      {item("RX",    String(pkts % 100000).padStart(5, "0"))}

      {/* Centre: live waveform oscilloscope */}
      <canvas ref={waveRef} style={{ height: 18, width: 100 }} />

      {/* Right cluster: system status — pushed to the far right with marginLeft auto */}
      <div style={{ display: "flex", gap: 24, marginLeft: "auto" }}>
        {item("UPTIME", fmtUptime(upSec))}
        {item("ERR",    "0.00%", C.green)}
        {item("SYS",    "NOMINAL", C.green)}
      </div>
    </div>
  );
}


// =============================================================================
// SectionReveal  (shared scroll-reveal wrapper)
//
// A lightweight hook + wrapper that uses IntersectionObserver to detect when
// a section enters the viewport. Once visible, it adds the "in" class which
// triggers the fadeSlideUp CSS animation defined in App's <style> block.
//
// Usage:
//   const [ref, inView] = useReveal();
//   <div ref={ref} style={{ opacity: inView ? 1 : 0, ... }}>...</div>
//
// We use a hook rather than a component wrapper so each section can compose
// the animation however it likes (different delays, directions, etc.).
// =============================================================================
function useReveal(threshold = 0.12) {
  const ref    = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Once in view, mark it and stop observing — we never re-hide it.
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, inView];
}


// =============================================================================
// SectionDivider  (shared section header)
//
// Renders the channel label + horizontal rule + section title that every
// content section uses. Keeps the visual language consistent.
//
// Props:
//   channel — e.g. "CH-03"
//   label   — e.g. "MISSION LOG // RESUME"
//   id      — anchor id for the <section> element (e.g. "resume")
// =============================================================================
function SectionDivider({ channel, label }) {
  return (
    <div style={{
      display:       "flex",
      alignItems:    "center",
      gap:           16,
      marginBottom:  40,
    }}>
      {/* Channel tag */}
      <span style={{
        fontFamily:    "'IBM Plex Mono', monospace",
        fontSize:      10,
        letterSpacing: "0.25em",
        color:         C.amber,
        whiteSpace:    "nowrap",
      }}>
        {channel}
      </span>

      {/* Horizontal rule that fills available space */}
      <div style={{
        flex:       1,
        height:     1,
        background: `linear-gradient(90deg, ${C.border}, transparent)`,
      }} />

      {/* Section label */}
      <span style={{
        fontFamily:    "'IBM Plex Mono', monospace",
        fontSize:      10,
        letterSpacing: "0.2em",
        color:         C.textDim,
        whiteSpace:    "nowrap",
      }}>
        {label}
      </span>
    </div>
  );
}


// =============================================================================
// SectionResume
//
// Linked by the RESUME button. Two-column layout:
//   Left  — experience timeline (Navy → Purdue → Target internship)
//   Right — skills bands (Systems, Networks, Software)
//
// Skills bars animate their width from 0 to the target value once the section
// enters the viewport, using a CSS transition triggered by `inView`.
// =============================================================================
function SectionResume() {
  const [ref, inView] = useReveal();

  // Each skill has a label, a fill colour key (matches C), and a target width %.
  const skillGroups = [
    {
      title: "Systems",
      color: "green",
      skills: [
        { label: "C / C++",      pct: 90 },
        { label: "Linux Kernel", pct: 85 },
        { label: "Rust",         pct: 72 },
        { label: "Assembly",     pct: 60 },
      ],
    },
    {
      title: "Networks",
      color: "amber",
      skills: [
        { label: "TCP/IP",    pct: 96 },
        { label: "RF / Radio",pct: 88 },
        { label: "Security",  pct: 80 },
        { label: "SDR",       pct: 74 },
      ],
    },
    {
      title: "Software",
      color: "cyan",
      skills: [
        { label: "Python",   pct: 88 },
        { label: "Go",       pct: 78 },
        { label: "ML / AI",  pct: 72 },
        { label: "React/TS", pct: 65 },
      ],
    },
  ];

  // Map colour key → actual hex value from the C palette.
  const colorMap = { green: C.green, amber: C.amber, cyan: C.cyan };

  // Timeline entries ordered newest → oldest (+ future target).
  const timeline = [
    {
      period:  "2024 – Present",
      role:    "B.S. Computer Science",
      org:     "Purdue University // West Lafayette, IN",
      desc:    "Focusing on systems, networks, and applied AI. Key coursework: OS, Compilers, Networks, ML, Cryptography. Dean's List.",
      dotColor: C.green,
    },
    {
      period:  "20XX – 20XX",
      role:    "Communications & Network Engineer",
      org:     "Republic of Korea Navy",
      desc:    "Designed and operated tactical communications networks for fleet operations. Managed RF systems, network infrastructure, and classified data transmission.",
      dotColor: C.amber,
    },
    {
      period:  "Target: 2025",
      role:    "Software / Systems Engineering Intern",
      org:     "Seeking // Infrastructure · Security · AI",
      desc:    "Open to roles at the systems or infrastructure layer — developer tools, security products, AI infrastructure, or early-stage startups.",
      dotColor: C.green,
      dimmed:  true, // slightly muted because it's a future/seeking entry
    },
  ];

  return (
    <section
      id="resume"
      ref={ref}
      style={{
        padding:     "80px 60px",
        borderTop:   `1px solid ${C.border}`,
        // Fade + slide up on reveal.
        opacity:     inView ? 1 : 0,
        transform:   inView ? "translateY(0)" : "translateY(24px)",
        transition:  "opacity 0.7s ease, transform 0.7s ease",
      }}
    >
      <SectionDivider channel="CH-03" label="MISSION LOG // RESUME" />

      {/* Two-column grid: timeline left, skills right */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "1fr 380px",
        gap:                 "60px 80px",
        alignItems:          "start",
      }}>

        {/* ── LEFT: Experience Timeline ── */}
        <div>
          <div style={{
            fontFamily:    "'IBM Plex Mono', monospace",
            fontSize:      9,
            letterSpacing: "0.2em",
            color:         C.amber,
            marginBottom:  24,
            textTransform: "uppercase",
          }}>
            // Service Record
          </div>

          {/* Timeline — each entry is a row with a dot, connector, and body */}
          <div style={{
            paddingLeft: 24,
            borderLeft:  `1px solid ${C.border}`,
          }}>
            {timeline.map((item, i) => (
              <div
                key={i}
                style={{
                  position:      "relative",
                  paddingBottom: i < timeline.length - 1 ? 36 : 0,
                  // Stagger each entry's reveal by 100ms so they cascade in.
                  opacity:       inView ? (item.dimmed ? 0.55 : 1) : 0,
                  transform:     inView ? "translateX(0)" : "translateX(-12px)",
                  transition:    `opacity 0.6s ease ${i * 0.1}s, transform 0.6s ease ${i * 0.1}s`,
                }}
              >
                {/* Dot — sits on the left border line */}
                <div style={{
                  position:     "absolute",
                  left:         -28,
                  top:          4,
                  width:        10,
                  height:       10,
                  borderRadius: "50%",
                  border:       `2px solid ${item.dotColor}`,
                  background:   C.bg,
                }} />

                {/* Period label */}
                <div style={{
                  fontFamily:    "'IBM Plex Mono', monospace",
                  fontSize:      10,
                  color:         C.amber,
                  letterSpacing: "0.1em",
                  marginBottom:  4,
                }}>
                  {item.period}
                </div>

                {/* Role title */}
                <div style={{
                  fontFamily:   "'DM Sans', sans-serif",
                  fontSize:     17,
                  fontWeight:   500,
                  color:        "#E0E8E0",
                  marginBottom: 2,
                  lineHeight:   1.3,
                }}>
                  {item.role}
                </div>

                {/* Organisation */}
                <div style={{
                  fontFamily:    "'IBM Plex Mono', monospace",
                  fontSize:      11,
                  color:         C.green,
                  marginBottom:  8,
                  letterSpacing: "0.05em",
                }}>
                  {item.org}
                </div>

                {/* Description */}
                <div style={{
                  fontFamily:  "'DM Sans', sans-serif",
                  fontSize:    13,
                  color:       C.textDim,
                  lineHeight:  1.75,
                  maxWidth:    480,
                  fontWeight:  300,
                }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Skills Bands ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{
            fontFamily:    "'IBM Plex Mono', monospace",
            fontSize:      9,
            letterSpacing: "0.2em",
            color:         C.amber,
            marginBottom:  -4,
            textTransform: "uppercase",
          }}>
            // Capability Matrix
          </div>

          {skillGroups.map((group, gi) => (
            <div
              key={group.title}
              style={{
                background:   "rgba(13,17,23,0.6)",
                border:       `1px solid ${C.border}`,
                borderRadius: 4,
                padding:      "16px 20px",
                // Each group cascades in 0.15s after the previous one.
                opacity:      inView ? 1 : 0,
                transform:    inView ? "translateX(0)" : "translateX(12px)",
                transition:   `opacity 0.6s ease ${gi * 0.15}s, transform 0.6s ease ${gi * 0.15}s`,
              }}
            >
              {/* Group title */}
              <div style={{
                fontFamily:    "'IBM Plex Mono', monospace",
                fontSize:      9,
                letterSpacing: "0.2em",
                color:         colorMap[group.color],
                textTransform: "uppercase",
                marginBottom:  14,
              }}>
                {group.title}
              </div>

              {/* Skill rows */}
              {group.skills.map((sk, si) => (
                <div key={sk.label} style={{
                  display:       "flex",
                  alignItems:    "center",
                  gap:           10,
                  marginBottom:  si < group.skills.length - 1 ? 10 : 0,
                }}>
                  {/* Label */}
                  <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize:   11,
                    color:      C.text,
                    minWidth:   88,
                  }}>
                    {sk.label}
                  </span>

                  {/* Bar track */}
                  <div style={{
                    flex:         1,
                    height:       2,
                    background:   "rgba(255,255,255,0.06)",
                    borderRadius: 1,
                    overflow:     "hidden",
                  }}>
                    {/* Fill — width transitions from 0 to sk.pct% when inView */}
                    <div style={{
                      height:     "100%",
                      borderRadius: 1,
                      background:   colorMap[group.color],
                      width:        inView ? `${sk.pct}%` : "0%",
                      // Each bar animates in sequence within its group.
                      transition:   `width 1.2s cubic-bezier(0.4,0,0.2,1) ${gi * 0.15 + si * 0.06}s`,
                    }} />
                  </div>

                  {/* Percentage readout */}
                  <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize:   10,
                    color:      C.textDim,
                    minWidth:   26,
                    textAlign:  "right",
                  }}>
                    {sk.pct}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}


// =============================================================================
// SectionPortfolio
//
// Linked by the PORTFOLIO button. A 2×2 grid of project cards.
// Each card has a frequency label, project name, description, and stack tags.
// Cards hover with a green top-border sweep (CSS transition on ::before equivalent).
// =============================================================================
function SectionPortfolio() {
  const [ref, inView] = useReveal();

  const projects = [
    {
      freq:  "433.920 MHz // P-01",
      name:  "NetSentry",
      desc:  "Real-time network intrusion detection at the kernel level using eBPF. Monitors packet flows with sub-millisecond latency, zero userspace overhead.",
      tags:  ["C", "eBPF", "Linux", "Security"],
      featured: [0, 1], // indices of tags to highlight in green
      link:  "#",
    },
    {
      freq:  "868.000 MHz // P-02",
      name:  "FreqMap",
      desc:  "SDR-based spectrum analyzer with ML anomaly detection. Visualises RF environments and flags unauthorised transmissions using trained classifiers.",
      tags:  ["Python", "GNU Radio", "PyTorch", "SDR"],
      featured: [0, 1],
      link:  "#",
    },
    {
      freq:  "2400.000 MHz // P-03",
      name:  "Callsign",
      desc:  "Distributed key-value store implementing Raft consensus from scratch. Fault-tolerant with linearisable reads and leader election under network partition.",
      tags:  ["Go", "Raft", "gRPC", "Protobuf"],
      featured: [0, 1],
      link:  "#",
    },
    {
      freq:  "5800.000 MHz // P-04",
      name:  "Sigscan",
      desc:  "CLI fingerprinting tool for wireless devices via passive 802.11 beacon frame analysis. Deployed in Navy field environments for RF assessment.",
      tags:  ["Rust", "802.11", "libpcap", "Field Use"],
      featured: [0, 3],
      link:  "#",
    },
  ];

  return (
    <section
      id="portfolio"
      ref={ref}
      style={{
        padding:    "80px 60px",
        borderTop:  `1px solid ${C.border}`,
        opacity:    inView ? 1 : 0,
        transform:  inView ? "translateY(0)" : "translateY(24px)",
        transition: "opacity 0.7s ease, transform 0.7s ease",
      }}
    >
      <SectionDivider channel="CH-04" label="PAYLOAD // PORTFOLIO" />

      {/* 2×2 card grid */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap:                 1,             // hairline gap between cards
        background:          C.border,      // gap colour = border colour → unified grid
        border:              `1px solid ${C.border}`,
        borderRadius:        4,
        overflow:            "hidden",
      }}>
        {projects.map((proj, i) => (
          <ProjectCard
            key={proj.name}
            proj={proj}
            // Stagger card appearance: 0ms, 80ms, 160ms, 240ms
            delay={i * 0.08}
            inView={inView}
          />
        ))}
      </div>
    </section>
  );
}

// ─── ProjectCard ─────────────────────────────────────────────────────────────
// Individual project card within SectionPortfolio.
// Manages its own hover state for the interactive border effect.
// ─────────────────────────────────────────────────────────────────────────────
function ProjectCard({ proj, delay, inView }) {
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href={proj.link}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:        "flex",
        flexDirection:  "column",
        padding:        "28px",
        background:     hovered ? "rgba(29,255,111,0.04)" : "rgba(13,17,23,0.9)",
        textDecoration: "none",
        cursor:         "pointer",
        // Top border sweeps in on hover (scaleX 0→1).
        // We simulate the ::before pseudo-element with a top-border div.
        position:       "relative",
        overflow:       "hidden",
        opacity:        inView ? 1 : 0,
        transform:      inView ? "translateY(0)" : "translateY(12px)",
        transition:     `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s, background 0.2s ease`,
      }}
    >
      {/* Animated top border — scales from left on hover */}
      <div style={{
        position:        "absolute",
        top:             0, left: 0, right: 0,
        height:          2,
        background:      C.green,
        transformOrigin: "left",
        transform:       hovered ? "scaleX(1)" : "scaleX(0)",
        transition:      "transform 0.3s ease",
      }} />

      {/* Frequency tag */}
      <div style={{
        fontFamily:    "'IBM Plex Mono', monospace",
        fontSize:      10,
        color:         C.green,
        letterSpacing: "0.1em",
        marginBottom:  10,
      }}>
        {proj.freq}
      </div>

      {/* Project name */}
      <div style={{
        fontFamily:   "'DM Sans', sans-serif",
        fontSize:     18,
        fontWeight:   500,
        color:        "#E0E8E0",
        marginBottom: 10,
        letterSpacing: "-0.01em",
      }}>
        {proj.name}
      </div>

      {/* Description */}
      <div style={{
        fontFamily:  "'DM Sans', sans-serif",
        fontSize:    13,
        color:       C.textDim,
        lineHeight:  1.7,
        fontWeight:  300,
        flex:        1,           // push tags to the bottom
        marginBottom: 20,
      }}>
        {proj.desc}
      </div>

      {/* Stack tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {proj.tags.map((tag, ti) => {
          const featured = proj.featured.includes(ti);
          return (
            <span key={tag} style={{
              fontFamily:    "'IBM Plex Mono', monospace",
              fontSize:      10,
              padding:       "2px 10px",
              border:        `1px solid ${featured ? C.greenDim : C.border}`,
              borderRadius:  2,
              color:         featured ? C.green : C.textDim,
              letterSpacing: "0.05em",
            }}>
              {tag}
            </span>
          );
        })}
      </div>
    </a>
  );
}


// =============================================================================
// SectionAlbum
//
// Linked by the ALBUM button. A masonry-style photo/media gallery.
// Currently uses placeholder tiles — replace the `src` fields with real image
// paths or import statements. Each tile shows a caption overlay on hover.
//
// The placeholder tiles use canvas-generated gradients so the section looks
// complete without actual images, making layout decisions easier.
// =============================================================================
function SectionAlbum() {
  const [ref, inView] = useReveal();

  // Album entries. Replace `placeholder` with an actual img src when ready.
  // `span` controls how many columns the card occupies (1 or 2).
  const entries = [
    { id: 1, label: "Fleet Operations // 20XX",       sub: "ROK Navy, East Sea",         span: 2, aspectRatio: "16/7"  },
    { id: 2, label: "Comms Array Deployment",          sub: "Field Exercise",              span: 1, aspectRatio: "4/3"   },
    { id: 3, label: "Purdue University // 2024",       sub: "West Lafayette, IN",          span: 1, aspectRatio: "4/3"   },
    { id: 4, label: "RF Lab // FreqMap Prototype",     sub: "SDR Build, 2024",             span: 1, aspectRatio: "4/3"   },
    { id: 5, label: "Radar Systems Study",             sub: "Coursework Documentation",    span: 1, aspectRatio: "4/3"   },
    { id: 6, label: "Seoul, Republic of Korea",        sub: "Home",                        span: 2, aspectRatio: "16/7"  },
  ];

  return (
    <section
      id="album"
      ref={ref}
      style={{
        padding:    "80px 60px 120px", // extra bottom padding above the status bar
        borderTop:  `1px solid ${C.border}`,
        opacity:    inView ? 1 : 0,
        transform:  inView ? "translateY(0)" : "translateY(24px)",
        transition: "opacity 0.7s ease, transform 0.7s ease",
      }}
    >
      <SectionDivider channel="CH-05" label="ARCHIVE // ALBUM" />

      {/* CSS grid: 2 equal columns, tiles can span both */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap:                 2,           // hairline gap between tiles
        background:          C.border,
        border:              `1px solid ${C.border}`,
        borderRadius:        4,
        overflow:            "hidden",
      }}>
        {entries.map((entry, i) => (
          <AlbumTile
            key={entry.id}
            entry={entry}
            delay={i * 0.07}
            inView={inView}
          />
        ))}
      </div>
    </section>
  );
}

// ─── AlbumTile ───────────────────────────────────────────────────────────────
// Individual tile in the SectionAlbum grid.
// Shows a gradient placeholder with a caption overlay that slides up on hover.
// Replace the background gradient with a real <img> tag when photos are ready.
// ─────────────────────────────────────────────────────────────────────────────
function AlbumTile({ entry, delay, inView }) {
  const [hovered, setHovered] = useState(false);

  // Generate a unique but deterministic gradient from the entry id.
  // Hue shifts around 140° (green) + slight variation per tile.
  const hue1 = (entry.id * 37 + 140) % 360;
  const hue2 = (entry.id * 73 + 180) % 360;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // `span` 2 makes the tile fill both columns (for wide landscape shots).
        gridColumn:     entry.span === 2 ? "span 2" : "span 1",
        aspectRatio:    entry.aspectRatio,
        position:       "relative",
        overflow:       "hidden",
        cursor:         "pointer",
        opacity:        inView ? 1 : 0,
        transform:      inView ? "scale(1)" : "scale(0.97)",
        transition:     `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s`,
        // Placeholder gradient — replace with <img> when real photos are ready.
        background:     `linear-gradient(135deg, hsl(${hue1},30%,8%) 0%, hsl(${hue2},20%,14%) 100%)`,
      }}
    >
      {/* Placeholder label shown when no real image is loaded */}
      <div style={{
        position:   "absolute",
        inset:      0,
        display:    "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize:   10,
        color:      C.border,
        letterSpacing: "0.15em",
        // Hidden once a real image is in place — the img would cover this.
        pointerEvents: "none",
        userSelect: "none",
      }}>
        [ PHOTO ]
      </div>

      {/* Caption overlay — slides up from the bottom on hover */}
      <div style={{
        position:   "absolute",
        bottom:     0, left: 0, right: 0,
        padding:    "20px 20px 16px",
        background: "linear-gradient(transparent, rgba(7,9,12,0.92))",
        transform:  hovered ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.3s ease",
      }}>
        {/* Caption title */}
        <div style={{
          fontFamily:   "'DM Sans', sans-serif",
          fontSize:     13,
          fontWeight:   500,
          color:        C.text,
          marginBottom: 3,
        }}>
          {entry.label}
        </div>
        {/* Caption sub-label */}
        <div style={{
          fontFamily:    "'IBM Plex Mono', monospace",
          fontSize:      10,
          color:         C.green,
          letterSpacing: "0.08em",
        }}>
          {entry.sub}
        </div>
      </div>

      {/* Hover border highlight */}
      <div style={{
        position:   "absolute",
        inset:      0,
        border:     `1px solid ${hovered ? C.greenDim : "transparent"}`,
        transition: "border-color 0.2s ease",
        pointerEvents: "none",
      }} />
    </div>
  );
}