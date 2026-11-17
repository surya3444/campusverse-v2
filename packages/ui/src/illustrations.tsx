// Campusverse artwork: flat, friendly scenes drawn only with theme colours, so they follow the
// palette and stay crisp at any size. Decorative: always aria-hidden. viewBox 240 × 160.
import type { ReactNode } from 'react';
import { cx } from './primitives';

export type IllustrationName =
  | 'welcome'
  | 'students'
  | 'attendance'
  | 'fees'
  | 'admissions'
  | 'exams'
  | 'certificates'
  | 'transport'
  | 'timetable'
  | 'notices'
  | 'yearEnd'
  | 'setup'
  | 'settings'
  | 'search'
  | 'empty';

/** The soft blob every scene sits on, with a few sparkles. */
function Stage({ tint = 'fill-navy-50' }: { tint?: string }) {
  return (
    <>
      <path
        className={tint}
        d="M38 108c-14-26 2-62 34-74 30-11 46 6 74 2 30-4 56 6 62 34 7 31-14 56-48 62-30 5-46-6-72-2-26 4-40-6-50-22z"
      />
      <circle className="fill-sun" cx="206" cy="30" r="4" />
      <circle className="fill-lilac" cx="26" cy="54" r="3" />
      <path className="fill-navy-400" d="M196 128l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
      <path className="fill-mint" d="M40 22l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" />
    </>
  );
}

function Person({
  x,
  y,
  body,
  skin = 'fill-skin',
  hair = 'fill-midnight-900',
  scale = 1,
}: {
  x: number;
  y: number;
  body: string;
  skin?: string;
  hair?: string;
  scale?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path className={body} d="M-18 44c0-16 8-26 18-26s18 10 18 26z" />
      <circle className={skin} cx="0" cy="6" r="11" />
      <path className={hair} d="M-11 4c0-9 6-14 11-14s12 4 11 13c-4-5-12-6-22 1z" />
    </g>
  );
}

const SCENES: Record<IllustrationName, ReactNode> = {
  welcome: (
    <>
      <Stage tint="fill-white/10" />
      <circle className="fill-sun" cx="178" cy="42" r="14" />
      {/* School building */}
      <path className="fill-navy-950" d="M70 66l50-28 50 28z" />
      <rect className="fill-white" x="76" y="66" width="88" height="56" rx="3" />
      <rect className="fill-navy-100" x="76" y="66" width="88" height="8" />
      <rect className="fill-navy-950" x="110" y="96" width="20" height="26" rx="10" />
      {[86, 142].map((x) => (
        <g key={x}>
          <rect className="fill-navy-200" x={x} y="82" width="12" height="12" rx="2" />
          <rect className="fill-navy-200" x={x} y="102" width="12" height="12" rx="2" />
        </g>
      ))}
      <circle className="fill-white" cx="120" cy="56" r="7" />
      <circle className="fill-sun" cx="120" cy="56" r="4" />
      <rect className="fill-midnight-900" x="119" y="22" width="2" height="18" />
      <path className="fill-coral" d="M121 22h14l-4 4 4 4h-14z" />
      {/* Trees */}
      <rect className="fill-skin-deep" x="49" y="104" width="4" height="18" />
      <circle className="fill-mint" cx="51" cy="98" r="12" />
      <rect className="fill-skin-deep" x="188" y="106" width="4" height="16" />
      <circle className="fill-mint" cx="190" cy="100" r="10" />
      <rect className="fill-navy-200" x="40" y="122" width="160" height="4" rx="2" />
    </>
  ),
  students: (
    <>
      <Stage tint="fill-sky-tint" />
      <Person x={84} y={74} body="fill-lilac" scale={0.9} />
      <Person x={156} y={74} body="fill-mint" skin="fill-skin-deep" scale={0.9} />
      <Person x={120} y={66} body="fill-navy-950" />
      {/* Book */}
      <path className="fill-white" d="M96 118l24 6 24-6v14l-24 6-24-6z" />
      <path className="fill-sun" d="M96 118l24 6v14l-24-6z" />
      <path className="fill-coral" d="M120 124l24-6v14l-24 6z" />
      <circle className="fill-white" cx="58" cy="44" r="12" />
      <path
        className="fill-none stroke-navy-950"
        strokeWidth="3"
        strokeLinecap="round"
        d="M53 44l4 4 7-8"
      />
    </>
  ),
  attendance: (
    <>
      <Stage tint="fill-teal-tint" />
      <rect className="fill-white" x="62" y="36" width="116" height="94" rx="10" />
      <rect className="fill-navy-950" x="62" y="36" width="116" height="22" rx="10" />
      <rect className="fill-navy-950" x="62" y="48" width="116" height="10" />
      <rect className="fill-white" x="84" y="28" width="6" height="16" rx="3" />
      <rect className="fill-white" x="150" y="28" width="6" height="16" rx="3" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => {
          const x = 74 + c * 20;
          const y = 66 + r * 15;
          const k = (r * 5 + c) % 7;
          return k === 3 ? (
            <circle key={`${r}${c}`} className="fill-coral" cx={x + 6} cy={y + 5} r="5" />
          ) : k % 2 === 0 ? (
            <circle key={`${r}${c}`} className="fill-mint" cx={x + 6} cy={y + 5} r="5" />
          ) : (
            <rect
              key={`${r}${c}`}
              className="fill-navy-100"
              x={x}
              y={y}
              width="12"
              height="10"
              rx="3"
            />
          );
        }),
      )}
      <circle className="fill-white stroke-navy-950" strokeWidth="3" cx="182" cy="110" r="18" />
      <path
        className="fill-none stroke-navy-950"
        strokeWidth="3"
        strokeLinecap="round"
        d="M182 100v10l7 5"
      />
    </>
  ),
  fees: (
    <>
      <Stage tint="fill-signal-go-tint" />
      {/* Receipt */}
      <path className="fill-white" d="M60 34h52v92l-6-4-7 4-6-4-7 4-6-4-7 4-6-4-7 4z" />
      {[46, 56, 66, 76].map((y, i) => (
        <rect
          key={y}
          className="fill-navy-100"
          x="68"
          y={y}
          width={i % 2 ? 26 : 36}
          height="5"
          rx="2.5"
        />
      ))}
      <rect className="fill-mint" x="68" y="94" width="36" height="8" rx="4" />
      {/* Wallet */}
      <rect
        className="fill-lilac"
        x="112"
        y="56"
        width="70"
        height="30"
        rx="6"
        transform="rotate(-8 147 71)"
      />
      <rect className="fill-navy-950" x="104" y="70" width="90" height="56" rx="10" />
      <rect className="fill-navy-900" x="160" y="88" width="34" height="20" rx="6" />
      <circle className="fill-sun" cx="172" cy="98" r="4" />
      {/* Coins */}
      <ellipse className="fill-signal-warn" cx="62" cy="128" rx="16" ry="5" />
      <ellipse className="fill-sun" cx="62" cy="124" rx="16" ry="5" />
      <ellipse className="fill-signal-warn" cx="62" cy="120" rx="16" ry="5" />
      <ellipse className="fill-sun" cx="62" cy="116" rx="16" ry="5" />
      <circle className="fill-sun stroke-signal-warn" strokeWidth="2" cx="200" cy="50" r="14" />
      <text
        x="200"
        y="55"
        textAnchor="middle"
        className="fill-signal-warn-ink"
        fontSize="14"
        fontWeight="700"
      >
        ₹
      </text>
    </>
  ),
  admissions: (
    <>
      <Stage tint="fill-rose-tint" />
      {/* Path of stages */}
      <path
        className="fill-none stroke-navy-200"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="2 9"
        d="M40 112c30-6 40-40 80-40s52-30 84-34"
      />
      {[
        [48, 110, 'fill-sky-ink'],
        [94, 82, 'fill-lilac'],
        [140, 70, 'fill-sun'],
      ].map(([x, y, c]) => (
        <circle key={String(x)} className={String(c)} cx={Number(x)} cy={Number(y)} r="7" />
      ))}
      {/* Door */}
      <rect className="fill-white" x="176" y="26" width="40" height="62" rx="20" />
      <rect className="fill-navy-950" x="182" y="32" width="28" height="56" rx="14" />
      <circle className="fill-sun" cx="203" cy="62" r="2.5" />
      <Person x={110} y={92} body="fill-coral" scale={0.85} />
      <Person x={136} y={88} body="fill-navy-950" skin="fill-skin-deep" scale={1} />
      <circle className="fill-signal-go" cx="196" cy="102" r="11" />
      <path
        className="fill-none stroke-white"
        strokeWidth="3"
        strokeLinecap="round"
        d="M191 102l4 4 6-7"
      />
    </>
  ),
  exams: (
    <>
      <Stage tint="fill-violet-tint" />
      <rect
        className="fill-navy-100"
        x="82"
        y="34"
        width="84"
        height="100"
        rx="8"
        transform="rotate(-6 124 84)"
      />
      <rect className="fill-white" x="76" y="30" width="84" height="100" rx="8" />
      {[48, 62, 76, 90, 104].map((y, i) => (
        <g key={y}>
          <circle className={i === 2 ? 'fill-coral' : 'fill-mint'} cx="90" cy={y + 2} r="4" />
          <rect
            className="fill-navy-100"
            x="100"
            y={y}
            width={i % 2 ? 34 : 46}
            height="5"
            rx="2.5"
          />
        </g>
      ))}
      <circle className="fill-sun" cx="164" cy="38" r="20" />
      <text
        x="164"
        y="45"
        textAnchor="middle"
        className="fill-midnight-900"
        fontSize="18"
        fontWeight="800"
      >
        A+
      </text>
      {/* Pencil */}
      <g transform="rotate(35 176 104)">
        <rect className="fill-navy-950" x="168" y="70" width="14" height="56" rx="2" />
        <rect className="fill-coral" x="168" y="66" width="14" height="8" rx="2" />
        <path className="fill-skin" d="M168 126h14l-7 14z" />
        <path className="fill-midnight-900" d="M172.5 135h5l-2.5 5z" />
      </g>
    </>
  ),
  certificates: (
    <>
      <Stage tint="fill-amber-tint" />
      <rect
        className="fill-white stroke-navy-200"
        strokeWidth="2"
        x="54"
        y="34"
        width="130"
        height="92"
        rx="6"
      />
      <rect
        className="fill-none stroke-navy-950"
        strokeWidth="2"
        x="62"
        y="42"
        width="114"
        height="76"
        rx="3"
      />
      <rect className="fill-navy-950" x="92" y="54" width="54" height="7" rx="3.5" />
      <rect className="fill-navy-100" x="80" y="70" width="78" height="5" rx="2.5" />
      <rect className="fill-navy-100" x="88" y="80" width="62" height="5" rx="2.5" />
      {/* QR */}
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) =>
          (r + c) % 2 === 0 || (r === 1 && c === 1) ? (
            <rect
              key={`${r}${c}`}
              className="fill-midnight-900"
              x={74 + c * 6}
              y={94 + r * 6}
              width="5"
              height="5"
            />
          ) : null,
        ),
      )}
      {/* Rosette */}
      <path className="fill-coral" d="M168 112l-8 26 9-5 5 9 6-26z" />
      <path className="fill-navy-950" d="M180 112l8 26-9-5-5 9-6-26z" />
      <circle className="fill-sun" cx="174" cy="106" r="16" />
      <circle className="fill-none stroke-white" strokeWidth="2" cx="174" cy="106" r="10" />
    </>
  ),
  timetable: (
    <>
      <Stage tint="fill-violet-tint" />
      {/* The week's grid: a board with coloured lessons */}
      <rect className="fill-white" x="40" y="30" width="132" height="98" rx="10" />
      <rect className="fill-navy-950" x="40" y="30" width="132" height="18" rx="9" />
      <rect className="fill-navy-950" x="40" y="40" width="132" height="8" />
      {[0, 1, 2, 3, 4].map((c) => (
        <rect
          key={c}
          className="fill-white"
          x={54 + c * 24}
          y="36"
          width="12"
          height="5"
          rx="2.5"
          opacity="0.7"
        />
      ))}
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <rect
            key={`${r}-${c}`}
            className={
              ['fill-lilac', 'fill-mint', 'fill-sun', 'fill-coral', 'fill-navy-100'][
                (r * 2 + c * 3) % 5
              ]
            }
            x={48 + c * 24}
            y={54 + r * 18}
            width="20"
            height="13"
            rx="3"
          />
        )),
      )}
      {/* One free period, ringed: a clash-free slot */}
      <rect
        className="fill-white stroke-navy-950"
        strokeWidth="2"
        x="96"
        y="72"
        width="20"
        height="13"
        rx="3"
      />
      {/* The clock */}
      <circle className="fill-navy-950" cx="184" cy="44" r="22" />
      <circle className="fill-white" cx="184" cy="44" r="17" />
      {[0, 90, 180, 270].map((a) => (
        <rect
          key={a}
          className="fill-navy-400"
          x="183"
          y="29"
          width="2"
          height="4"
          rx="1"
          transform={`rotate(${a} 184 44)`}
        />
      ))}
      <path
        className="fill-none stroke-navy-950"
        strokeWidth="2.5"
        strokeLinecap="round"
        d="M184 44V34M184 44l7 4"
      />
      <circle className="fill-coral" cx="184" cy="44" r="2" />
      {/* A teacher pointing at the board */}
      <circle className="fill-skin" cx="196" cy="92" r="9" />
      <path className="fill-midnight-900" d="M187 90c0-7 4-11 9-11s10 3 9 10c-3-4-10-4-18 1z" />
      <path className="fill-lilac" d="M182 128c0-16 6-26 14-26s14 10 14 26z" />
      <path
        className="fill-none stroke-skin"
        strokeWidth="4"
        strokeLinecap="round"
        d="M186 110l-12-10"
      />
    </>
  ),
  transport: (
    <>
      <Stage tint="fill-amber-tint" />
      {/* The route: dotted from the last stop to the school pin */}
      <path
        className="fill-none stroke-navy-400"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 7"
        d="M44 52c18-20 50-24 76-14s54 8 64-6"
      />
      <path
        className="fill-coral"
        d="M184 18a10 10 0 0 1 10 10c0 8-10 18-10 18s-10-10-10-18a10 10 0 0 1 10-10z"
      />
      <circle className="fill-white" cx="184" cy="28" r="4" />
      {/* Road */}
      <rect className="fill-navy-200" x="34" y="122" width="172" height="6" rx="3" />
      {[52, 92, 132, 172].map((x) => (
        <rect key={x} className="fill-white" x={x} y="124" width="16" height="2" rx="1" />
      ))}
      {/* Bus stop */}
      <rect className="fill-midnight-900" x="199" y="74" width="3" height="48" rx="1.5" />
      <circle className="fill-navy-950" cx="200.5" cy="72" r="10" />
      <rect className="fill-sun" x="195" y="68" width="11" height="7" rx="2" />
      {/* Bus */}
      <rect className="fill-sun" x="52" y="60" width="132" height="58" rx="10" />
      <path className="fill-sun" d="M176 78h8a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8h-8z" />
      <rect className="fill-coral" x="52" y="98" width="140" height="4" />
      <rect className="fill-navy-100" x="166" y="68" width="14" height="24" rx="3" />
      {[62, 88, 114, 140].map((x, i) => (
        <g key={x}>
          <rect className="fill-white" x={x} y="68" width="20" height="24" rx="3" />
          <circle className={i % 2 ? 'fill-skin-deep' : 'fill-skin'} cx={x + 10} cy="84" r="6" />
          <path
            className="fill-midnight-900"
            d={`M${x + 4} 83c0-5 3-8 6-8s7 2 6 7c-2-3-7-3-12 1z`}
          />
          <rect
            className={['fill-lilac', 'fill-mint', 'fill-navy-950', 'fill-coral'][i]}
            x={x + 4}
            y="89"
            width="12"
            height="3"
            rx="1.5"
          />
        </g>
      ))}
      <circle className="fill-white" cx="188" cy="108" r="3" />
      <rect className="fill-navy-950" x="58" y="106" width="16" height="4" rx="2" />
      {[84, 160].map((cx) => (
        <g key={cx}>
          <circle className="fill-midnight-900" cx={cx} cy="118" r="11" />
          <circle className="fill-navy-200" cx={cx} cy="118" r="4" />
        </g>
      ))}
    </>
  ),
  notices: (
    <>
      <Stage tint="fill-violet-tint" />
      {/* Megaphone */}
      <path className="fill-navy-950" d="M66 84l62-30v68l-62-26z" />
      <rect className="fill-navy-900" x="54" y="82" width="16" height="18" rx="4" />
      <path className="fill-coral" d="M74 98l8 26h10l-6-23z" />
      <ellipse className="fill-navy-200" cx="128" cy="88" rx="7" ry="34" />
      <path
        className="fill-none stroke-navy-400"
        strokeWidth="4"
        strokeLinecap="round"
        d="M146 70c8 10 8 26 0 36M158 60c14 16 14 40 0 56"
      />
      {/* Bubbles */}
      <rect className="fill-white" x="166" y="28" width="52" height="30" rx="12" />
      <path className="fill-white" d="M176 56l-4 10 12-8z" />
      <rect className="fill-mint" x="176" y="38" width="32" height="5" rx="2.5" />
      <rect className="fill-navy-100" x="176" y="46" width="22" height="5" rx="2.5" />
      <rect className="fill-white" x="176" y="104" width="46" height="26" rx="11" />
      <rect className="fill-lilac" x="185" y="113" width="28" height="5" rx="2.5" />
    </>
  ),
  yearEnd: (
    <>
      <Stage />
      <rect className="fill-navy-100" x="56" y="98" width="40" height="28" rx="4" />
      <rect className="fill-navy-200" x="96" y="76" width="40" height="50" rx="4" />
      <rect className="fill-navy-950" x="136" y="54" width="40" height="72" rx="4" />
      <text
        x="156"
        y="94"
        textAnchor="middle"
        className="fill-white"
        fontSize="16"
        fontWeight="800"
      >
        ↑
      </text>
      {/* Cap */}
      <path className="fill-midnight-900" d="M156 20l30 12-30 12-30-12z" />
      <path className="fill-midnight-800" d="M140 38v10c0 4 7 7 16 7s16-3 16-7V38l-16 6z" />
      <path className="fill-none stroke-sun" strokeWidth="2.5" d="M184 33v16" />
      <circle className="fill-sun" cx="184" cy="51" r="3.5" />
      {/* Confetti */}
      <rect
        className="fill-coral"
        x="70"
        y="56"
        width="6"
        height="10"
        rx="2"
        transform="rotate(25 73 61)"
      />
      <rect
        className="fill-mint"
        x="104"
        y="44"
        width="6"
        height="10"
        rx="2"
        transform="rotate(-20 107 49)"
      />
      <rect
        className="fill-sun"
        x="196"
        y="76"
        width="6"
        height="10"
        rx="2"
        transform="rotate(40 199 81)"
      />
      <rect
        className="fill-lilac"
        x="86"
        y="74"
        width="5"
        height="9"
        rx="2"
        transform="rotate(-35 88 78)"
      />
    </>
  ),
  setup: (
    <>
      <Stage tint="fill-teal-tint" />
      <rect className="fill-white" x="58" y="30" width="86" height="104" rx="10" />
      {[46, 70, 94].map((y, i) => (
        <g key={y}>
          <circle className={i < 2 ? 'fill-signal-go' : 'fill-navy-100'} cx="76" cy={y + 6} r="8" />
          {i < 2 && (
            <path
              className="fill-none stroke-white"
              strokeWidth="2.5"
              strokeLinecap="round"
              d={`M72 ${y + 6}l3 3 5-6`}
            />
          )}
          <rect className="fill-navy-100" x="90" y={y + 2} width="42" height="5" rx="2.5" />
          <rect className="fill-navy-50" x="90" y={y + 10} width="28" height="4" rx="2" />
        </g>
      ))}
      {/* Blocks */}
      <rect className="fill-navy-950" x="150" y="96" width="34" height="34" rx="6" />
      <rect className="fill-sun" x="186" y="96" width="34" height="34" rx="6" />
      <rect className="fill-coral" x="168" y="60" width="34" height="34" rx="6" />
      <text
        x="167"
        y="119"
        textAnchor="middle"
        className="fill-white"
        fontSize="16"
        fontWeight="800"
      >
        A
      </text>
      <text
        x="203"
        y="119"
        textAnchor="middle"
        className="fill-midnight-900"
        fontSize="16"
        fontWeight="800"
      >
        B
      </text>
      <text
        x="185"
        y="83"
        textAnchor="middle"
        className="fill-white"
        fontSize="16"
        fontWeight="800"
      >
        C
      </text>
    </>
  ),
  settings: (
    <>
      <Stage />
      <g transform="translate(100 78)">
        {Array.from({ length: 8 }, (_, i) => (
          <rect
            key={i}
            className="fill-navy-950"
            x="-6"
            y="-38"
            width="12"
            height="16"
            rx="3"
            transform={`rotate(${i * 45})`}
          />
        ))}
        <circle className="fill-navy-950" r="28" />
        <circle className="fill-white" r="11" />
      </g>
      <g transform="translate(160 54)">
        {Array.from({ length: 6 }, (_, i) => (
          <rect
            key={i}
            className="fill-lilac"
            x="-4"
            y="-22"
            width="8"
            height="10"
            rx="2"
            transform={`rotate(${i * 60})`}
          />
        ))}
        <circle className="fill-lilac" r="16" />
        <circle className="fill-white" r="6" />
      </g>
      <rect className="fill-white" x="138" y="96" width="70" height="34" rx="10" />
      <rect className="fill-navy-100" x="148" y="106" width="50" height="5" rx="2.5" />
      <rect className="fill-navy-950" x="148" y="106" width="30" height="5" rx="2.5" />
      <circle className="fill-white stroke-navy-950" strokeWidth="2.5" cx="178" cy="108.5" r="5" />
      <rect className="fill-navy-100" x="148" y="118" width="50" height="5" rx="2.5" />
      <rect className="fill-mint" x="148" y="118" width="18" height="5" rx="2.5" />
    </>
  ),
  search: (
    <>
      <Stage />
      <rect className="fill-white" x="64" y="40" width="96" height="26" rx="8" />
      <rect className="fill-white" x="64" y="72" width="96" height="26" rx="8" />
      <rect className="fill-white" x="64" y="104" width="96" height="26" rx="8" />
      {[40, 72, 104].map((y) => (
        <g key={y}>
          <circle className="fill-navy-100" cx="78" cy={y + 13} r="6" />
          <rect className="fill-navy-100" x="90" y={y + 10} width="52" height="6" rx="3" />
        </g>
      ))}
      <circle className="fill-white/60 stroke-navy-950" strokeWidth="7" cx="166" cy="80" r="24" />
      <rect
        className="fill-navy-950"
        x="182"
        y="98"
        width="10"
        height="34"
        rx="5"
        transform="rotate(-45 187 115)"
      />
    </>
  ),
  empty: (
    <>
      <Stage />
      <path className="fill-navy-100" d="M66 86l20-40h68l20 40z" />
      <path className="fill-white" d="M78 82l14-30h56l14 30z" />
      <path
        className="fill-navy-950"
        d="M60 86h40c0 10 8 16 20 16s20-6 20-16h40v32a8 8 0 0 1-8 8H68a8 8 0 0 1-8-8z"
      />
      <rect className="fill-sun" x="108" y="56" width="24" height="5" rx="2.5" />
      <rect className="fill-lilac" x="100" y="66" width="40" height="5" rx="2.5" />
    </>
  ),
};

/** A decorative scene. Size it with className (it keeps its 3:2 shape). */
export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 240 160"
      className={cx('h-auto shrink-0 select-none', className)}
    >
      {SCENES[name]}
    </svg>
  );
}
