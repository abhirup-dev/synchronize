// Chat background presets — procedural SVG art, Japanese-scroll aesthetics.
// All fills use translucent inks so the same artwork reads on every theme
// paper (light and dark); the per-skin treatment (painterly in brutal,
// shine-through in glass) lives in chat-bg.css.

export interface ChatBackground {
  id: string;
  name: string;
  /** CSS background-image value, or null for no background. */
  image: string | null;
  size: string;
  repeat: string;
}

function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}")`;
}

/* The Great Wave — claw wave, foam curls, Fuji beyond. */
const GREAT_WAVE = svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700">
  <path d="M820 470 L950 300 L1080 470 Z" fill="rgba(72,88,128,0.30)"/>
  <path d="M905 360 L950 300 L995 360 L972 352 L950 364 L928 352 Z" fill="rgba(255,255,255,0.55)"/>
  <path d="M0 700 L0 420 C120 360 200 470 320 430 C250 480 260 520 200 560 C400 500 520 560 660 520 C600 570 610 600 560 640 C760 580 920 620 1200 560 L1200 700 Z" fill="rgba(46,72,124,0.42)"/>
  <path d="M0 420 C60 300 220 260 340 320 C420 360 430 430 380 470 C470 430 560 460 600 520 C540 540 480 540 430 520 C470 560 450 600 400 610 C300 640 140 600 60 520 Z" fill="rgba(38,60,108,0.50)"/>
  <path d="M340 320 C300 270 230 260 190 290 C240 280 280 300 300 330 Z M380 470 C420 440 430 390 410 360 C420 400 400 440 370 455 Z" fill="rgba(255,255,255,0.45)"/>
  <g fill="rgba(255,255,255,0.40)">
    <circle cx="350" cy="300" r="7"/><circle cx="380" cy="285" r="5"/><circle cx="410" cy="300" r="6"/>
    <circle cx="320" cy="285" r="5"/><circle cx="440" cy="315" r="5"/><circle cx="470" cy="335" r="6"/>
    <circle cx="500" cy="360" r="5"/><circle cx="250" cy="430" r="5"/><circle cx="290" cy="450" r="6"/>
  </g>
  <path d="M0 700 L0 560 C160 600 340 580 480 620 C640 660 860 620 1040 650 C1100 660 1160 650 1200 640 L1200 700 Z" fill="rgba(30,48,92,0.55)"/>
  <circle cx="1080" cy="180" r="46" fill="rgba(214,96,77,0.40)"/>
</svg>`);

/* Sumi-e mountains — layered ink-wash ridges, mist, vermilion sun. */
const INK_MOUNTAINS = svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700">
  <circle cx="200" cy="150" r="52" fill="rgba(214,96,77,0.42)"/>
  <path d="M0 700 L0 430 C140 380 230 300 360 250 C470 210 540 260 640 320 C760 390 900 420 1200 400 L1200 700 Z" fill="rgba(56,66,92,0.12)"/>
  <path d="M0 700 L0 500 C180 470 280 380 420 360 C560 340 660 420 800 450 C940 480 1080 470 1200 450 L1200 700 Z" fill="rgba(52,62,88,0.20)"/>
  <rect x="0" y="430" width="1200" height="40" fill="rgba(255,255,255,0.20)"/>
  <path d="M0 700 L0 580 C220 560 340 490 500 480 C660 470 780 540 940 560 C1040 572 1140 566 1200 556 L1200 700 Z" fill="rgba(46,56,82,0.30)"/>
  <rect x="0" y="540" width="1200" height="30" fill="rgba(255,255,255,0.16)"/>
  <path d="M0 700 L0 650 C260 630 420 590 620 600 C820 610 1020 650 1200 640 L1200 700 Z" fill="rgba(40,50,76,0.40)"/>
  <g stroke="rgba(46,56,82,0.35)" stroke-width="3" fill="none" stroke-linecap="round">
    <path d="M950 610 q10 -40 2 -70 M950 575 q-22 -8 -30 -28 M950 585 q20 -10 26 -32"/>
  </g>
</svg>`);

/* Seigaiha — overlapping wave-scale fans. */
const SEIGAIHA = (() => {
  const ring = (cx: number, cy: number) =>
    [44, 34, 24, 14]
      .map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`)
      .join("");
  return svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 88" width="176" height="88">
  <g fill="rgba(255,255,255,0.001)" stroke="rgba(72,104,168,0.38)" stroke-width="3">
    ${ring(0, 44)}${ring(88, 44)}${ring(176, 44)}
    ${ring(44, 88)}${ring(132, 88)}
    ${ring(44, 0)}${ring(132, 0)}
  </g>
</svg>`);
})();

/* Sakura drift — scattered petals and two blossoms on a faint branch. */
const SAKURA = (() => {
  const petal = (x: number, y: number, rot: number, a: number) =>
    `<ellipse cx="${x}" cy="${y}" rx="7" ry="12" transform="rotate(${rot} ${x} ${y})" fill="rgba(232,140,170,${a})"/>`;
  const blossom = (x: number, y: number, s: number, a: number) => {
    let p = "";
    for (let i = 0; i < 5; i++) {
      const ang = i * 72;
      p += `<ellipse cx="${x}" cy="${y - 11 * s}" rx="${6.5 * s}" ry="${11 * s}" transform="rotate(${ang} ${x} ${y})" fill="rgba(238,160,186,${a})"/>`;
    }
    return p + `<circle cx="${x}" cy="${y}" r="${3.4 * s}" fill="rgba(196,90,110,${a + 0.1})"/>`;
  };
  return svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" width="480" height="480">
  <path d="M-20 90 C120 60 220 130 360 110 C420 102 460 80 500 60" stroke="rgba(96,68,58,0.28)" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M180 118 q-8 30 -30 44 M300 112 q4 28 24 42" stroke="rgba(96,68,58,0.22)" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  ${blossom(150, 162, 1.1, 0.4)}
  ${blossom(324, 154, 0.85, 0.34)}
  ${petal(80, 250, 24, 0.34)}${petal(210, 300, -40, 0.28)}${petal(330, 260, 70, 0.30)}
  ${petal(420, 350, -15, 0.26)}${petal(120, 390, 50, 0.26)}${petal(260, 430, -65, 0.30)}
  ${petal(380, 60, 30, 0.24)}${petal(40, 60, -50, 0.22)}${petal(450, 200, 12, 0.22)}
</svg>`);
})();

export const CHAT_BACKGROUNDS: ChatBackground[] = [
  { id: "none", name: "No background", image: null, size: "cover", repeat: "no-repeat" },
  { id: "great-wave", name: "The Great Wave", image: GREAT_WAVE, size: "cover", repeat: "no-repeat" },
  { id: "ink-mountains", name: "Ink-wash mountains", image: INK_MOUNTAINS, size: "cover", repeat: "no-repeat" },
  { id: "seigaiha", name: "Seigaiha waves", image: SEIGAIHA, size: "176px 88px", repeat: "repeat" },
  { id: "sakura", name: "Sakura drift", image: SAKURA, size: "480px 480px", repeat: "repeat" },
];

export function chatBackgroundById(id: string | null): ChatBackground {
  return CHAT_BACKGROUNDS.find((b) => b.id === id) ?? CHAT_BACKGROUNDS[0]!;
}
