/* =========================================================
   Kode — Main app (game state + UI + program interpreter)
   ========================================================= */

const { useState, useEffect, useRef, useCallback, useMemo } = React;
const { useDraggable, useDropZone, useDragActive } = window.KodeDnD;
const { COLOR_LIST, COLOR_HEX } = window.KODE;
const COLOR_LT = { red: 'raudona', blue: 'mėlyna', yellow: 'geltona', green: 'žalia' };
const colorLt = c => COLOR_LT[c] || c;

// ---------- ids ----------
let __nextId = 1;
const nid = () => 'b' + (__nextId++);

// ---------- level ----------
// Fixed first level — every obstacle is followed by at least one normal tile.
const LAYOUT = [
  { type: 'normal' },    // 0 start
  { type: 'wheel' },     // 1
  { type: 'normal' },    // 2 — clear tile after wheel
  { type: 'gap' },       // 3
  { type: 'normal' },    // 4 — clear tile after gap
  { type: 'wheel' },     // 5
  { type: 'normal' },    // 6 — clear tile after wheel
  { type: 'gap' },       // 7
  { type: 'normal' },    // 8 — clear tile after gap
  { type: 'finish' },    // 9
];

const WHEEL_STARTS = [1, 2];
const LEVEL_LENGTH = 10;
const GAP_COUNT = 2;
const WHEEL_COUNT = 2;

function seededRandom(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rand) {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function isValidLayout(layout) {
  for (let i = 0; i < layout.length - 1; i++) {
    const cur  = layout[i].type;
    const next = layout[i + 1].type;
    // Every obstacle must be followed by a clear (normal or finish) tile
    if ((cur === 'gap' || cur === 'wheel') && next !== 'normal' && next !== 'finish') return false;
  }
  return true;
}

function layoutForSeed(seed) {
  if (seed === 1) return LAYOUT;
  const inner = [
    ...Array(WHEEL_COUNT).fill({ type: 'wheel' }),
    ...Array(GAP_COUNT).fill({ type: 'gap' }),
    ...Array(LEVEL_LENGTH - 2 - WHEEL_COUNT - GAP_COUNT).fill({ type: 'normal' }),
  ];

  for (let attempt = 0; attempt < 200; attempt++) {
    const rand = seededRandom(seed * 97 + attempt);
    const layout = [{ type: 'normal' }, ...shuffled(inner, rand).map(t => ({ ...t })), { type: 'finish' }];
    if (isValidLayout(layout)) return layout;
  }

  return LAYOUT;
}

function normalizeColorIndex(index) {
  return ((index % COLOR_LIST.length) + COLOR_LIST.length) % COLOR_LIST.length;
}

function wheelFromIndex(index) {
  const colorIndex = normalizeColorIndex(index);
  return { type: 'wheel', colorIndex, color: COLOR_LIST[colorIndex] };
}

function spinWheelTile(tile, steps = 1) {
  const cur = tile.colorIndex ?? COLOR_LIST.indexOf(tile.color);
  return wheelFromIndex(cur + steps);
}

const IF_CONDITIONS = [
  {
    id: 'next-type-normal',
    object: 'Kliūtis priekyje',
    property: 'Tipas',
    value: 'Be kliūties',
    label: 'Kliūtis: be kliūties',
  },
  {
    id: 'next-type-gap',
    object: 'Kliūtis priekyje',
    property: 'Tipas',
    value: 'Duobė',
    label: 'Kliūtis: duobė',
  },
  {
    id: 'next-type-wheel',
    object: 'Kliūtis priekyje',
    property: 'Tipas',
    value: 'Ratas',
    label: 'Kliūtis: ratas',
  },
  ...COLOR_LIST.map(color => ({
    id: `next-wheel-color-${color}`,
    object: 'Kliūtis priekyje',
    property: 'Spalva',
    value: color,
    label: `Rato spalva: ${colorLt(color)}`,
  })),
];

const DEFAULT_IF_CONDITION = IF_CONDITIONS[0].id;

function getIfCondition(id) {
  return IF_CONDITIONS.find(c => c.id === id) || IF_CONDITIONS[0];
}

function obstacleName(type) {
  if (type === 'normal') return 'Be kliūties';
  if (type === 'gap') return 'Duobė';
  if (type === 'wheel') return 'Ratas';
  if (type === 'finish') return 'Be kliūties';
  return 'Nežinoma';
}

function makeLevel(seed) {
  let wheel = 0;
  return layoutForSeed(seed).map((t) => {
    if (t.type === 'wheel') {
      const start = WHEEL_STARTS[wheel % WHEEL_STARTS.length] + seed - 1;
      wheel += 1;
      return wheelFromIndex(start);
    }
    return { ...t };
  });
}

// ---------- block templates ----------
function makeBlock(type) {
  if (type === 'walk')   return { id: nid(), type: 'walk' };
  if (type === 'jump')   return { id: nid(), type: 'jump' };
  if (type === 'swipe')  return { id: nid(), type: 'swipe' };
  if (type === 'repeat') return { id: nid(), type: 'repeat', body: [] };
  if (type === 'if')     return { id: nid(), type: 'if', condition: DEFAULT_IF_CONDITION, then: [], els: [] };
  return null;
}

// deep clone (preserve ids? no — fresh ids for new copies)
function cloneBlock(b) {
  const n = { ...b, id: nid() };
  if (b.type === 'repeat') n.body = b.body.map(cloneBlock);
  if (b.type === 'if') { n.then = b.then.map(cloneBlock); n.els = b.els.map(cloneBlock); }
  return n;
}

// ---------- path operations ----------
// program tree path: array like ['root', idx] or ['b3', 'body', idx]
// We'll use ids + helper functions to find/insert/remove by location.

function removeBlockById(list, id) {
  let removed = null;
  const next = [];
  for (const b of list) {
    if (b.id === id) { removed = b; continue; }
    let nb = b;
    if (b.type === 'repeat') {
      const r = removeBlockById(b.body, id);
      if (r.removed) { nb = { ...b, body: r.list }; removed = r.removed; }
    } else if (b.type === 'if') {
      const t = removeBlockById(b.then, id);
      if (t.removed) { nb = { ...b, then: t.list }; removed = t.removed; }
      const e = removeBlockById(nb.els, id);
      if (e.removed) { nb = { ...nb, els: e.list }; removed = e.removed; }
    }
    next.push(nb);
  }
  return { list: next, removed };
}

function insertIntoList(list, block, beforeId) {
  if (!beforeId) return [...list, block];
  const idx = list.findIndex(b => b.id === beforeId);
  if (idx < 0) return [...list, block];
  const next = list.slice();
  next.splice(idx, 0, block);
  return next;
}

// insert into slot path -> {parentId?, slot: 'root'|'body'|'then'|'els', beforeId?}
function insertBlock(program, slot, block) {
  if (slot.kind === 'root') return insertIntoList(program, block, slot.beforeId);
  return program.map(b => {
    if (b.id !== slot.parentId) {
      let nb = b;
      if (b.type === 'repeat') nb = { ...nb, body: insertBlock(nb.body, slot, block) };
      if (b.type === 'if') { nb = { ...nb, then: insertBlock(nb.then, slot, block), els: insertBlock(nb.els, slot, block) }; }
      return nb;
    }
    if (b.type === 'repeat' && slot.kind === 'body') return { ...b, body: insertIntoList(b.body, block, slot.beforeId) };
    if (b.type === 'if' && slot.kind === 'then') return { ...b, then: insertIntoList(b.then, block, slot.beforeId) };
    if (b.type === 'if' && slot.kind === 'els') return { ...b, els: insertIntoList(b.els, block, slot.beforeId) };
    return b;
  });
}

function updateBlockById(list, id, patch) {
  return list.map(b => {
    if (b.id === id) return { ...b, ...patch };
    let nb = b;
    if (b.type === 'repeat') nb = { ...nb, body: updateBlockById(nb.body, id, patch) };
    if (b.type === 'if') nb = { ...nb, then: updateBlockById(nb.then, id, patch), els: updateBlockById(nb.els, id, patch) };
    return nb;
  });
}

// =========================================================
// ICONS
// =========================================================
const Icon = {
  Walk: () => (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <circle cx="18" cy="6" r="3" fill="white"/>
      <path d="M16 10 L13 17 L9 21 M16 10 L19 17 L23 22 M13 17 L18 17 L18 23" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Jump: () => (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <circle cx="14" cy="6" r="3" fill="white"/>
      <path d="M14 10 V16 L9 21 M14 16 L19 21 M10 13 H18" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 23 Q14 14 23 23" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" opacity="0.7"/>
    </svg>
  ),
  Swipe: () => (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path d="M6 14 H20" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M16 9 L21 14 L16 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="6" cy="14" r="2.5" fill="white"/>
    </svg>
  ),
  Repeat: () => (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path d="M20 8 H8 a4 4 0 0 0 0 8 H10 M8 20 H20 a4 4 0 0 0 0 -8 H18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <path d="M18 5 L21 8 L18 11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 17 L7 20 L10 23" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  If: () => (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
      <path d="M14 4 L24 14 L14 24 L4 14 Z" stroke="white" strokeWidth="2.4" strokeLinejoin="round"/>
      <text x="14" y="18" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="Fredoka, sans-serif">?</text>
    </svg>
  ),
  Play: () => (
    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 5 V19 L19 12 Z" fill="white"/></svg>
  ),
  Stop: () => (
    <svg viewBox="0 0 24 24" width="20" height="20"><rect x="6" y="6" width="12" height="12" rx="2" fill="white"/></svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <rect x="5" y="5" width="5" height="14" rx="1.5" fill="white"/>
      <rect x="14" y="5" width="5" height="14" rx="1.5" fill="white"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>
    </svg>
  ),
  Close: () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </svg>
  ),
  Shuffle: () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5 M4 20l17-17 M21 16v5h-5 M15 15l6 6 M4 4l5 5"/>
    </svg>
  ),
  Chevron: ({ up = false }) => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? 'M6 15 L12 9 L18 15' : 'M6 9 L12 15 L18 9'} />
    </svg>
  ),
  Rabbit: () => (
    <svg viewBox="0 0 32 32" width="22" height="22">
      <ellipse cx="16" cy="22" rx="9" ry="6" fill="#f7f3eb" stroke="#bba98a"/>
      <rect x="10" y="6" width="3" height="11" rx="1" fill="#f7f3eb" stroke="#bba98a"/>
      <rect x="19" y="6" width="3" height="11" rx="1" fill="#f7f3eb" stroke="#bba98a"/>
      <circle cx="13" cy="19" r="1" fill="#1d1d1d"/>
      <circle cx="19" cy="19" r="1" fill="#1d1d1d"/>
      <ellipse cx="16" cy="22" rx="1.5" ry="1" fill="#ff8aa0"/>
    </svg>
  ),
};

// =========================================================
// BLOCK COMPONENT
// =========================================================
function Block({ block, source, isExecuting }) {
  const draggable = source !== 'preview';
  const payloadFactory = useCallback(() => {
    if (source === 'toolbox') return { kind: 'new', block: cloneBlock(block) };
    return { kind: 'move', blockId: block.id, block };
  }, [block, source]);
  const onPointerDown = useDraggable(payloadFactory);
  const onDown = draggable ? onPointerDown : undefined;

  const isExe = isExecuting === block.id;

  if (block.type === 'repeat') {
    return (
      <div className={`block repeat container ${isExe ? 'executing' : ''}`} onPointerDown={onDown}>
        <div className="control-head">
          <Icon.Repeat />
          <div className="label">Kartoti</div>
          <div className="count-pill">kol baigs</div>
        </div>
        {source === 'toolbox' ? (
          <div className="slot" style={{ minWidth: 56, opacity: 0.6, justifyContent: 'center' }}>
            <div className="slot-empty">...</div>
          </div>
        ) : (
          <Slot parentId={block.id} kind="body" items={block.body} isExecuting={isExecuting} />
        )}
      </div>
    );
  }

  if (block.type === 'if') {
    const condition = getIfCondition(block.condition);
    const visual = partsFromCondition(block.condition);
    const selectedType = visual.obstacle;
    const selectedColor = visual.colorMode;
    return (
      <div className={`block if container ${isExe ? 'executing' : ''}`} onPointerDown={onDown}>
        <div className="control-head">
          <Icon.If />
          <div className="label">Jei</div>
          <div className="condition-pill">
            {condition.property}
          </div>
          <div className="if-swatches" title={condition.label}>
            <span className={`if-type-swatch ${selectedType}`} aria-label={`Obstacle type: ${obstacleName(selectedType)}`}>
              {selectedType === 'wheel' ? <i></i> : null}
            </span>
            {selectedColor ? (
              <span
                className="if-color-swatch"
                style={{ background: '#' + COLOR_HEX[selectedColor].toString(16).padStart(6, '0') }}
                aria-label={`Color: ${selectedColor}`}
              ></span>
            ) : null}
          </div>
        </div>
        {source === 'toolbox' ? (
          <div className="if-branches">
            <div className="slot if-preview-slot" style={{ minWidth: 56, height: 32, opacity: 0.6 }}>
              <div className="slot-empty" style={{ fontSize: 9 }}>✓ ...</div>
            </div>
            <div className="slot if-preview-slot" style={{ minWidth: 56, height: 32, opacity: 0.6 }}>
              <div className="slot-empty" style={{ fontSize: 9 }}>✗ ...</div>
            </div>
          </div>
        ) : (
          <div className="if-branches">
            <Slot parentId={block.id} kind="then" items={block.then} isExecuting={isExecuting} label="✓" />
            <Slot parentId={block.id} kind="els"  items={block.els}  isExecuting={isExecuting} label="✗" />
          </div>
        )}
      </div>
    );
  }

  // basic action
  const IconComp = block.type === 'walk' ? Icon.Walk : block.type === 'jump' ? Icon.Jump : Icon.Swipe;
  return (
    <div className={`block ${block.type} ${isExe ? 'executing' : ''}`} onPointerDown={onDown}>
      <IconComp />
      <div className="label">{{ walk: 'eiti', jump: 'šokti', swipe: 'sukti' }[block.type] || block.type}</div>
    </div>
  );
}

// =========================================================
// SLOT — drop zone inside a container block
// =========================================================
function DropMarker({ parentId, kind, beforeId }) {
  const ctx = React.useContext(ProgramCtx);
  const dropId = `${parentId}:${kind}:before:${beforeId || 'end'}`;
  const onDrop = useCallback((payload) => {
    if (payload.kind === 'move' && payload.blockId === beforeId) return;
    ctx.onDropAt(payload, { kind, parentId, beforeId });
  }, [parentId, kind, beforeId, ctx]);
  const isHover = useDropZone(dropId, onDrop);
  return <div data-drop-id={dropId} className={`drop-marker ${isHover ? 'drop-active' : ''}`} />;
}

function SequenceItems({ parentId, kind, items, isExecuting }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map(b => (
        <React.Fragment key={b.id}>
          <DropMarker parentId={parentId} kind={kind} beforeId={b.id} />
          <Block block={b} source="program" isExecuting={isExecuting} />
        </React.Fragment>
      ))}
      <DropMarker parentId={parentId} kind={kind} beforeId={null} />
    </>
  );
}

function Slot({ parentId, kind, items, isExecuting, label }) {
  const dropId = `${parentId}:${kind}`;
  const ctx = React.useContext(ProgramCtx);
  const onDrop = useCallback((payload) => ctx.onDropAt(payload, { kind, parentId }), [parentId, kind, ctx]);
  const isHover = useDropZone(dropId, onDrop);
  const dragActive = useDragActive();
  const slotStyle = {
    minHeight: label ? undefined : 36,
    minWidth: items.length === 0 ? 70 : undefined,
    position: 'relative',
  };
  return (
    <div
      data-drop-id={dropId}
      className={`slot ${label ? 'branch-slot' : ''} ${isHover ? 'drop-active' : ''}`}
      style={slotStyle}
    >
      {label ? (
        <div style={{
          position: 'absolute', top: -2, left: 4, fontSize: 11, color: 'rgba(255,255,255,.95)',
          fontWeight: 700, pointerEvents: 'none'
        }}>{label}</div>
      ) : null}
      {items.length === 0 ? (
        <div className="slot-empty">{label ? '' : 'drop here'}</div>
      ) : (
        <SequenceItems parentId={parentId} kind={kind} items={items} isExecuting={isExecuting} />
      )}
    </div>
  );
}

const ProgramCtx = React.createContext(null);

// =========================================================
// PROGRAM ROW (root slot)
// =========================================================
function Program({ program, onDropAt, isExecuting }) {
  const onDrop = useCallback((payload) => onDropAt(payload, { kind: 'root' }), [onDropAt]);
  const isHover = useDropZone('program-root', onDrop);
  const dragActive = useDragActive();
  return (
    <ProgramCtx.Provider value={{ onDropAt }}>
      <div
        className={`program ${isHover ? 'drop-active' : ''}`}
        data-drop-id="program-root"
      >
        <div className="program-label">Programa</div>
        {program.length === 0 ? (
          <div className="program-empty">{dragActive ? 'paleisti' : 'vilkite veiksmus čia →'}</div>
        ) : (
          <SequenceItems parentId="root" kind="root" items={program} isExecuting={isExecuting} />
        )}
      </div>
    </ProgramCtx.Provider>
  );
}

// =========================================================
// TOOLBOX (drag source)
// =========================================================
function Toolbox({ onReturnBlock }) {
  const templates = useMemo(() => [
    makeBlock('walk'), makeBlock('jump'), makeBlock('swipe'),
    makeBlock('repeat'), makeBlock('if'),
  ], []);
  const onDrop = useCallback((payload) => {
    if (payload.kind === 'move') onReturnBlock(payload);
  }, [onReturnBlock]);
  const isHover = useDropZone('toolbox-return', onDrop);
  return (
    <div className={`toolbox ${isHover ? 'drop-active' : ''}`} data-drop-id="toolbox-return">
      <div className="label">{isHover ? 'Grąžinti' : 'Veiksmai'}</div>
      <div className="tools">
        {templates.map(b => (
          <Block key={b.id} block={b} source="toolbox" />
        ))}
      </div>
    </div>
  );
}

// =========================================================
// TRASH
// =========================================================
function Trash({ onDrop, onDeleteLast, disabled }) {
  const isHover = useDropZone('trash', onDrop);
  return (
    <button
      className={`trash-btn ${isHover ? 'drop-active' : ''}`}
      data-drop-id="trash"
      onClick={onDeleteLast}
      disabled={disabled}
      title="Ištrinti paskutinį žingsnį"
    >
      <Icon.Trash />
    </button>
  );
}

// =========================================================
// FLOATING CONTROLS (Play / Pause / Stop)
// =========================================================
function FloatingControls({ running, paused, onPlay, onPause, onStop, disabled }) {
  return (
    <div className="floating-controls">
      <button
        className="float-btn play-float"
        onClick={onPlay}
        disabled={running || disabled}
        title="Paleisti"
        aria-label="Paleisti"
      >
        <Icon.Play />
        <span>Paleisti</span>
      </button>
      <button
        className={`float-btn pause-float${paused ? ' is-paused' : ''}`}
        onClick={onPause}
        disabled={!running}
        title={paused ? 'Tęsti' : 'Pauzė'}
        aria-label={paused ? 'Tęsti' : 'Pauzė'}
      >
        {paused ? <Icon.Play /> : <Icon.Pause />}
        <span>{paused ? 'Tęsti' : 'Pauzė'}</span>
      </button>
      <button
        className="float-btn stop-float"
        onClick={onStop}
        disabled={!running}
        title="Sustabdyti"
        aria-label="Sustabdyti"
      >
        <Icon.Stop />
        <span>Sustabdyti</span>
      </button>
    </div>
  );
}

// =========================================================
// PROPERTY PANEL
// =========================================================
function PropsPanel({ hatColor, onHatColor, level, open, onToggle }) {
  const obstacleTypes = [
    { type: 'normal', label: 'Be kliūties', detail: 'eiti', tone: 'safe' },
    { type: 'gap', label: 'Duobė', detail: 'šokti', tone: 'gap' },
    { type: 'wheel', label: 'Ratas', detail: 'sukti', tone: 'wheel' },
  ];

  if (!open) {
    return (
      <button className="props-collapsed" onClick={onToggle} title="Atidaryti savybes">
        <Icon.Rabbit />
        <span>Savybės</span>
      </button>
    );
  }

  return (
    <div className="props-panel">
      <div className="panel-head">
        <h3>Savybės</h3>
        <button className="panel-close" onClick={onToggle} title="Uždaryti savybes">
          <Icon.Close />
        </button>
      </div>
      <div className="obj-card">
        <div className="obj-avatar"><Icon.Rabbit /></div>
        <div>
          <div className="obj-name">Triušis</div>
          <div className="obj-sub">veikėjas</div>
        </div>
      </div>
      <div className="object-map" aria-label="Veikėjo objekto modelis">
        <div className="map-row"><span>Objektas</span><strong>Veikėjas</strong></div>
        <div className="map-row"><span>Savybė</span><strong>Kepurės spalva</strong></div>
        <div className="action-chip-row" aria-label="Veikėjo veiksmai">
          <span className="action-chip walk">eiti</span>
          <span className="action-chip jump">šokti</span>
          <span className="action-chip swipe">sukti</span>
        </div>
      </div>
      <div className="prop-row">
        <div className="lbl">Kepurės spalva · <strong>{colorLt(hatColor)}</strong></div>
        <div className="swatch-row">
          {COLOR_LIST.map(c => (
            <button
              key={c}
              className={`swatch ${c === hatColor ? 'active' : ''}`}
              style={{ background: '#' + COLOR_HEX[c].toString(16).padStart(6, '0') }}
              onClick={() => onHatColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>
      <div className="obstacle-list">
        {obstacleTypes.map(item => (
          <div className={`obstacle-row ${item.tone}`} key={item.type}>
            <span className="obstacle-mark"></span>
            <span className="obstacle-name">{item.label}</span>
            <strong>{item.detail}</strong>
          </div>
        ))}
      </div>
      <div className="legend">
        <strong>Tikslas</strong>: pasiekti vėliavą.<br />
        <strong>Duobė</strong> → šokti.<br />
        <strong>Ratas</strong> → sukti žingsnį prieš, tada eiti kai spalva sutampa su kepure.<br />
        Braukite lygį arba paspauskite <strong>Keisti lygį</strong>, kad išmaišytumėte kliūtis.
      </div>
    </div>
  );
}

// =========================================================
// TOP BAR
// =========================================================
function TopBar({ onSwipeLevel, onFirstLevel, onMenu, levelSeed, tiles }) {
  const wheelCount = tiles.filter(t => t.type === 'wheel').length;
  return (
    <div className="top-bar">
      <button className="menu-btn" onClick={onMenu}>
        <span className="bars"><span/><span/><span/></span>
      </button>
      <div className="level-title">
        <span className="lbl">Lygis</span>
        <span>{levelSeed}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: '#7d8b6c', fontSize: 13 }}>{wheelCount} ratai</span>
      </div>
      <div className="top-actions">
        <button className="round-btn" onClick={onSwipeLevel} title="Pakeisti kliūčių išdėstymą">
          <Icon.Shuffle />
          Keisti lygį
        </button>
        <button
          className="round-btn level1-btn"
          onClick={onFirstLevel}
          disabled={levelSeed === 1}
          title="Grįžti į 1 lygį"
        >
          1 lygis
        </button>
      </div>
    </div>
  );
}

// =========================================================
// STATUS BUBBLE
// =========================================================
function StatusBubble({ status }) {
  if (!status) return null;
  return <div className={`status-bubble show ${status.kind || ''}`}>{status.msg}</div>;
}

// =========================================================
// MENU MODAL
// =========================================================
function MenuModal({ open, onClose, onReset }) {
  if (!open) return null;
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Kode</h2>
        <p>
          Kiekvienas objektas turi <strong>savybes</strong> ir <strong>veiksmus</strong>. Pasirink kepurės spalvą
          triušiui, tada vilk veiksmus į programą ir išmok jį pasiekti vėliavą.
        </p>
        <p style={{ fontSize: 14, color: '#7d8b6c' }}>
          Padaryk programą tokią išmanią, kad <em>Keisti lygį</em> vis tiek veiktų!
        </p>
        <div className="modal-actions">
          <button className="round-btn primary" onClick={onClose}>Supratau</button>
          <button className="round-btn" onClick={() => { onReset(); onClose(); }}>Atstatyti programą</button>
        </div>
      </div>
    </div>
  );
}

function WinModal({ open, onContinue }) {
  if (!open) return null;
  return (
    <div className="modal-veil" onClick={onContinue}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="win-glyph">🏁</div>
        <h2>Puikus kodavimas!</h2>
        <p>Tavo triušis pasiekė vėliavą. Išbandyk <strong>Keisti lygį</strong> ir paleisk dar kartą — ar programa vis tiek veikia?</p>
        <div className="modal-actions">
          <button className="round-btn primary" onClick={onContinue}>Tęsti žaidimą</button>
        </div>
      </div>
    </div>
  );
}

// Returns { obstacle: 'normal'|'gap'|'wheel', colorMode: null | <color string> }
function partsFromCondition(condition) {
  if (condition === 'next-type-gap')   return { obstacle: 'gap',    colorMode: null };
  if (condition === 'next-type-wheel') return { obstacle: 'wheel',  colorMode: null };
  if (condition && condition.startsWith('next-wheel-color-')) {
    return { obstacle: 'wheel', colorMode: condition.replace('next-wheel-color-', '') };
  }
  return { obstacle: 'normal', colorMode: null };
}

// colorMode: null → wheel-only check; string → wheel + specific color check
function conditionFromVisualChoice(obstacle, colorMode) {
  if (obstacle === 'wheel') {
    return colorMode ? `next-wheel-color-${colorMode}` : 'next-type-wheel';
  }
  return `next-type-${obstacle}`;
}

function MiniObstacle({ type }) {
  if (type === 'gap') {
    return (
      <span className="mini-obstacle gap">
        <span></span>
      </span>
    );
  }
  if (type === 'wheel') {
    return (
      <span className="mini-obstacle wheel">
        <span className="wheel-ring">
          <i></i><i></i><i></i><i></i>
        </span>
      </span>
    );
  }
  return (
    <span className="mini-obstacle normal">
      <span></span>
    </span>
  );
}

function IfConfigModal({ pending, onCancel, onConfirm }) {
  const initial = partsFromCondition(pending?.block?.condition);
  const [obstacle, setObstacle] = useState(initial.obstacle);
  const [colorMode, setColorMode] = useState(initial.colorMode);

  useEffect(() => {
    const next = partsFromCondition(pending?.block?.condition);
    setObstacle(next.obstacle);
    setColorMode(next.colorMode);
  }, [pending]);

  if (!pending) return null;

  const condition = conditionFromVisualChoice(obstacle, colorMode);
  const summary = getIfCondition(condition);
  const obstacleOptions = [
    { id: 'normal', label: 'Be kliūties' },
    { id: 'gap', label: 'Duobė' },
    { id: 'wheel', label: 'Ratas' },
  ];

  return (
    <div className="modal-veil" onClick={onCancel}>
      <div className="modal config-modal" onClick={e => e.stopPropagation()}>
        <h2>Jei kliūtis yra...</h2>
        <div className="visual-choice-grid">
          {obstacleOptions.map(option => (
            <button
              key={option.id}
              className={`visual-choice ${obstacle === option.id ? 'active' : ''}`}
              onClick={() => {
                setObstacle(option.id);
                if (option.id !== 'wheel') setColorMode(null);
              }}
            >
              <MiniObstacle type={option.id} />
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
        {obstacle === 'wheel' ? (
          <div className="color-choice-panel">
            <div className="choice-label">
              Spalva <span style={{ fontWeight: 400, opacity: .65 }}>(neprivaloma — palieskite, kad perjungtumėte)</span>
            </div>
            <div className="color-choice-row">
              {COLOR_LIST.map(option => (
                <button
                  key={option}
                  className={`color-choice ${colorMode === option ? 'active' : ''}`}
                  onClick={() => setColorMode(prev => prev === option ? null : option)}
                >
                  <span style={{ background: '#' + COLOR_HEX[option].toString(16).padStart(6, '0') }}></span>
                  <strong>{option}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="compare-preview">
          <span>Jei</span>
          <strong>{summary.label}</strong>
        </div>
        <div className="modal-actions">
          <button className="round-btn primary" onClick={() => onConfirm(condition)}>Pridėti Jei</button>
          <button className="round-btn" onClick={onCancel}>Atšaukti</button>
        </div>
      </div>
    </div>
  );
}

function ObstacleModal({ obstacle, hatColor, onClose }) {
  if (!obstacle) return null;
  const tile = obstacle.tile;
  const typeName = obstacleName(tile.type);
  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal obstacle-modal" onClick={e => e.stopPropagation()}>
        <h2>{typeName}</h2>
        <div className="property-table">
          <div><span>Objektas</span><strong>Kliūtis</strong></div>
          <div><span>Pozicija</span><strong>{obstacle.index + 1}</strong></div>
          <div><span>Tipas</span><strong>{typeName}</strong></div>
          {tile.type === 'wheel' ? (
            <>
              <div><span>Spalva</span><strong>{colorLt(tile.color)}</strong></div>
              <div><span>Atitinka kepurę</span><strong>{tile.color === hatColor ? 'taip' : 'ne'}</strong></div>
            </>
          ) : null}
          {tile.type === 'gap' ? <div><span>Veiksmas</span><strong>šokti</strong></div> : null}
          {tile.type === 'normal' || tile.type === 'finish' ? <div><span>Veiksmas</span><strong>eiti</strong></div> : null}
        </div>
        <div className="modal-actions">
          <button className="round-btn primary" onClick={onClose}>Atlikta</button>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// MAIN APP
// =========================================================
function App() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);

  const [hatColor, setHatColor] = useState('red');
  const [levelSeed, setLevelSeed] = useState(1);
  const [tiles, setTiles] = useState(() => makeLevel(1));
  const [program, setProgram] = useState([]);
  const [executingId, setExecutingId] = useState(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(null);
  const [menuOpen, setMenuOpen] = useState(true); // start with intro
  const [winOpen, setWinOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(true);
  const [pendingIf, setPendingIf] = useState(null);
  const [selectedObstacle, setSelectedObstacle] = useState(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [paused, setPaused] = useState(false);

  const runRef = useRef({ cancel: false, paused: false });
  const swipeRef = useRef(null);

  // --- mount three.js scene ---
  useEffect(() => {
    const canvas = document.getElementById('game-canvas');
    canvasRef.current = canvas;
    const s = new window.GameScene(canvas);
    sceneRef.current = s;
    s.rebuildLevel(tiles);
    s.setHatColor(hatColor);
    s.setCelebrationColor(hatColor);
  }, []);

  // sync hat color
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setHatColor(hatColor);
      sceneRef.current.setCelebrationColor(hatColor);
    }
  }, [hatColor]);

  // sync level
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.rebuildLevel(tiles);
  }, [tiles]);

  // ---- program editing ----
  const handleDrop = useCallback((payload, target) => {
    if (payload.kind === 'new' && payload.block.type === 'if') {
      setPendingIf({ target, block: cloneBlock(payload.block) });
      return;
    }
    setProgram((prev) => {
      if (payload.kind === 'move' && payload.blockId === target.beforeId) return prev;
      let p = prev;
      let block = payload.block;
      if (payload.kind === 'move') {
        const r = removeBlockById(p, payload.blockId);
        p = r.list;
        block = r.removed || block;
        if (!block) return prev;
        // prevent dropping into own descendants — simple guard: skip
        // (acceptable: most kids won't try this)
      } else {
        // new from toolbox — always a fresh clone
        block = cloneBlock(block);
      }
      return insertBlock(p, target, block);
    });
  }, []);

  const confirmIfBlock = useCallback((condition) => {
    if (!pendingIf) return;
    const block = { ...pendingIf.block, condition };
    const target = pendingIf.target;
    setProgram(prev => insertBlock(prev, target, block));
    setPendingIf(null);
  }, [pendingIf]);

  const handleTrash = useCallback((payload) => {
    if (payload.kind !== 'move') return;
    setProgram(prev => removeBlockById(prev, payload.blockId).list);
  }, []);

  const deleteLastStep = useCallback(() => {
    if (running) return;
    setProgram(prev => prev.length ? prev.slice(0, -1) : prev);
  }, [running]);

  // ---- interpreter ----
  function flash(msg, kind = '') {
    setStatus({ msg, kind });
    setTimeout(() => setStatus(s => (s && s.msg === msg ? null : s)), 1500);
  }

  // execution context (mutable during a run)
  function makeCtx() {
    return {
      tiles: tiles.map(t => ({ ...t })),
      pos: 0,
      hat: hatColor,
      failed: false,
      finished: false,
    };
  }

  // wait helper that respects cancel and pause
  function delay(ms) {
    return new Promise(res => {
      let elapsed = 0;
      const step = 30;
      const tick = () => {
        if (runRef.current.cancel) { res(); return; }
        if (!runRef.current.paused) elapsed += step;
        if (elapsed >= ms) { res(); return; }
        setTimeout(tick, step);
      };
      setTimeout(tick, step);
    });
  }

  async function execList(list, ctx) {
    for (const b of list) {
      if (runRef.current.cancel || ctx.failed || ctx.finished) return;
      await execBlock(b, ctx);
    }
  }

  function evalIfCondition(conditionId, ctx) {
    const next = ctx.tiles[ctx.pos + 1];
    if (!next) return false;
    if (conditionId === 'next-type-normal') return next.type === 'normal' || next.type === 'finish';
    if (conditionId === 'next-type-gap')    return next.type === 'gap';
    if (conditionId === 'next-type-wheel')  return next.type === 'wheel';
    if (conditionId && conditionId.startsWith('next-wheel-color-')) {
      if (next.type !== 'wheel') return false;
      const color = conditionId.replace('next-wheel-color-', '');
      return next.color === color;
    }
    return false;
  }

  async function execBlock(b, ctx) {
    setExecutingId(b.id);
    await delay(180);
    const scene = sceneRef.current;

    if (b.type === 'walk') {
      const to = ctx.pos + 1;
      if (to >= ctx.tiles.length) { ctx.finished = true; await scene.walkTo(to); return; }
      const target = ctx.tiles[to];
      if (target.type === 'gap') {
        flash('Pliumpstelėjo! Naudok Šokti per duobes.', 'err');
        await scene.fall(to);
        ctx.failed = true; return;
      }
      if (target.type === 'wheel' && target.color !== ctx.hat) {
        flash('Sukink ratą, kol spalva sutaps su kepure.', 'err');
        await scene.shake();
        ctx.failed = true; return;
      }
      await scene.walkTo(to);
      ctx.pos = to;
      if (ctx.tiles[ctx.pos].type === 'finish') ctx.finished = true;
    }
    else if (b.type === 'jump') {
      const to = ctx.pos + 2;
      if (to >= ctx.tiles.length) {
        ctx.finished = true;
        await scene.jumpTo(to);
        return;
      }
      const target = ctx.tiles[to];
      if (target.type === 'gap') {
        flash('Pliumpstelėjo! Nėra kur nusileisti.', 'err');
        await scene.fall(to);
        ctx.failed = true; return;
      }
      if (target.type === 'wheel') {
        flash('Negalima nusileisti ant rato — šok per jį, ne ant jo.', 'err');
        await scene.shake();
        ctx.failed = true; return;
      }
      await scene.jumpTo(to);
      ctx.pos = to;
      if (ctx.tiles[ctx.pos].type === 'finish') ctx.finished = true;
    }
    else if (b.type === 'swipe') {
      const targetIdx = ctx.pos + 1;
      const target = ctx.tiles[targetIdx];
      if (!target || target.type !== 'wheel') {
        flash('Sukti veikia vieną žingsnį prieš ratą.', 'err');
        await scene.shake();
        ctx.failed = true;
        return;
      }
      const next = spinWheelTile(target);
      await scene.spinWheel(targetIdx, next.color, next.colorIndex);
      ctx.tiles[targetIdx] = next;
      // Auto-step onto the wheel if the color now matches the hat
      if (next.color === ctx.hat) {
        await scene.walkTo(targetIdx);
        ctx.pos = targetIdx;
        if (ctx.tiles[ctx.pos].type === 'finish') ctx.finished = true;
      }
    }
    else if (b.type === 'repeat') {
      if (b.body.length === 0) {
        flash('Kartoti reikia veiksmų viduje.', 'err');
        ctx.failed = true;
        return;
      }
      for (let i = 0; i < 80; i++) {
        if (runRef.current.cancel || ctx.failed || ctx.finished) break;
        await execList(b.body, ctx);
      }
      if (!runRef.current.cancel && !ctx.failed && !ctx.finished) {
        flash('Kartojimas sustojo: nepasiekė finišo.', 'err');
        ctx.failed = true;
      }
    }
    else if (b.type === 'if') {
      const match = evalIfCondition(b.condition, ctx);
      if (match) await execList(b.then, ctx);
      else await execList(b.els, ctx);
    }
    setExecutingId(null);
  }

  async function runProgram() {
    if (running || program.length === 0) {
      if (!running) flash('Pirma pridėk veiksmų!', 'err');
      return;
    }
    runRef.current.cancel = false;
    runRef.current.paused = false;
    setPaused(false);
    setRunning(true);
    setStatus(null);
    const ctx = makeCtx();
    // reset character to start
    sceneRef.current.rebuildLevel(tiles);
    sceneRef.current.setHatColor(hatColor);
    await delay(120);
    await execList(program, ctx);
    setExecutingId(null);
    setRunning(false);
    runRef.current.paused = false;
    setPaused(false);
    if (ctx.finished) {
      flash('Pasiekei vėliavą! 🏁', 'win');
      await sceneRef.current.celebrate();
      setWinOpen(true);
    } else if (ctx.failed) {
      // status already set; wait briefly then reset to start
      await delay(900);
      sceneRef.current.rebuildLevel(tiles);
      sceneRef.current.setHatColor(hatColor);
    } else {
      flash('Programa baigėsi — bet vėliava vis dar ten. Pridėk daugiau veiksmų!', 'err');
    }
  }

  function stopProgram() {
    runRef.current.cancel = true;
    runRef.current.paused = false;
    setPaused(false);
  }

  function togglePause() {
    if (!running) return;
    const next = !runRef.current.paused;
    runRef.current.paused = next;
    setPaused(next);
  }

  function swipeLevel() {
    if (running) return;
    const nextSeed = levelSeed === 1 ? 2 : (levelSeed % 99) + 1;
    setLevelSeed(nextSeed);
    setTiles(makeLevel(nextSeed));
    setSelectedObstacle(null);
    flash('Lygis pakeistas: kliūtys permaišytos.');
  }

  function goToFirstLevel() {
    if (running) return;
    setLevelSeed(1);
    setTiles(makeLevel(1));
    setSelectedObstacle(null);
    flash('Grįžta į 1 lygį.');
  }

  function resetProgram() {
    if (running) return;
    setProgram([]);
  }

  function handleLevelPointerDown(e) {
    if (running || e.pointerType === 'mouse' && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, active: true };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handleLevelPointerUp(e) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || running) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.4) swipeLevel();
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const idx = sceneRef.current?.pickTileAt(e.clientX, e.clientY);
      if (idx != null && tiles[idx]) setSelectedObstacle({ index: idx, tile: tiles[idx] });
    }
  }

  return (
    <>
      <div className="ui-layer">
        <div
          className="level-swipe-zone"
          onPointerDown={handleLevelPointerDown}
          onPointerUp={handleLevelPointerUp}
          aria-label="Swipe level area"
        />
        <TopBar
          onSwipeLevel={swipeLevel}
          onFirstLevel={goToFirstLevel}
          onMenu={() => setMenuOpen(true)}
          levelSeed={levelSeed}
          tiles={tiles}
        />
        <PropsPanel
          hatColor={hatColor}
          onHatColor={setHatColor}
          level={tiles}
          open={propsOpen}
          onToggle={() => setPropsOpen(open => !open)}
        />
        <StatusBubble status={status} />

        <FloatingControls
          running={running}
          paused={paused}
          onPlay={runProgram}
          onPause={togglePause}
          onStop={stopProgram}
          disabled={program.length === 0}
        />

        <div className="dock">
          {dockOpen ? (
            <>
              <div className="dock-toolbar">
                <Toolbox onReturnBlock={handleTrash} />
                <div className="dock-toolbar-right">
                  <button
                    className="round-btn clear-dock-btn"
                    onClick={resetProgram}
                    disabled={running || program.length === 0}
                    title="Išvalyti programą"
                  >
                    Valyti
                  </button>
                  <Trash onDrop={handleTrash} onDeleteLast={deleteLastStep} disabled={running || program.length === 0} />
                  <button
                    className="dock-collapse-btn"
                    onClick={() => setDockOpen(false)}
                    title="Sutraukti"
                  >
                    <Icon.Chevron />
                  </button>
                </div>
              </div>
              <Program program={program} onDropAt={handleDrop} isExecuting={executingId} />
            </>
          ) : (
            <button className="dock-summary-btn" onClick={() => setDockOpen(true)}>
              <Icon.Chevron up />
              <span>Veiksmai ir Programa</span>
              <strong>{program.length}</strong>
            </button>
          )}
        </div>
      </div>

      <MenuModal open={menuOpen} onClose={() => setMenuOpen(false)} onReset={resetProgram} />
      <WinModal open={winOpen} onContinue={() => setWinOpen(false)} />
      <IfConfigModal pending={pendingIf} onCancel={() => setPendingIf(null)} onConfirm={confirmIfBlock} />
      <ObstacleModal obstacle={selectedObstacle} hatColor={hatColor} onClose={() => setSelectedObstacle(null)} />
    </>
  );
}

// boot
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
