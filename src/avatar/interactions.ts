import type { AvatarAction, createDriver } from './driver';
type Driver = ReturnType<typeof createDriver>;
export function dragOffset(
  start: { x: number; y: number },
  dx: number,
  dy: number,
  width: number,
  height: number,
) {
  return {
    x: Math.max(-0.3, Math.min(0.3, start.x + dx / Math.max(1, width))),
    y: Math.max(-0.18, Math.min(0.18, start.y + dy / Math.max(1, height))),
  };
}
export interface GesturePlayer {
  width: number;
  height: number;
  view: { x: number; y: number; zoom: number };
  hitTest(x: number, y: number): string | null;
  layout(): { scale: number; left: number; top: number; rect: DOMRect };
  meshes: { vertices: number }[];
  rig: number;
  rt: {
    memory: WebAssembly.Memory;
    p2l_mesh_count(rig: number): number;
    p2l_mesh_id(rig: number, index: number): number;
    p2l_mesh_vertices(rig: number, index: number): number;
  };
  string(pointer: number): string;
}
export function mountInteractions(
  canvas: HTMLCanvasElement,
  player: GesturePlayer,
  driver: Driver,
  notify: (value: unknown) => void,
) {
  const root = canvas.parentElement!;
  const menu = document.createElement('div'),
    toggle = document.createElement('button'),
    bubble = document.createElement('div'),
    food = document.createElement('div'),
    sticks = document.createElement('div');
  const buttonStyle =
    'border:1px solid #ead5df;border-radius:14px;background:#fff8fc;color:#78465f;padding:7px 10px;font:13px system-ui;touch-action:manipulation;';
  toggle.textContent = '⋯';
  toggle.setAttribute('aria-label', '角色互动');
  toggle.style.cssText = buttonStyle + 'position:absolute;right:10px;bottom:5px;z-index:20;';
  menu.style.cssText =
    'position:absolute;bottom:38px;left:50%;transform:translateX(-50%);display:none;gap:5px;flex-wrap:wrap;justify-content:center;width:260px;max-width:95%;z-index:30;';
  bubble.style.cssText =
    'position:absolute;top:6px;left:50%;transform:translateX(-50%);pointer-events:none;border-radius:12px;background:#fff8fc;color:#78465f;padding:5px 10px;font:13px system-ui;display:none;z-index:15;';
  bubble.setAttribute('aria-live', 'polite');
  food.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:12;';
  food.innerHTML =
    '<svg viewBox="0 0 90 60" xmlns="http://www.w3.org/2000/svg"><ellipse cx="45" cy="22" rx="36" ry="18" fill="#fffdf2" stroke="#dbc5b7" stroke-width="2"/><path d="M8 23Q12 59 45 59Q78 59 82 23Z" fill="#e9aac4" stroke="#9a5b77" stroke-width="3"/><path d="M18 37Q45 53 72 37" fill="none" stroke="#fff5fa" stroke-width="4"/><path d="M24 17l5 -4m8 2l3 -5m10 5l5 -4m9 7l3 -4" stroke="#e5d4bd" stroke-width="2"/></svg>';
  sticks.style.cssText =
    'position:absolute;pointer-events:none;display:none;z-index:13;transform-origin:0 50%;';
  sticks.innerHTML =
    '<svg viewBox="0 0 100 25" xmlns="http://www.w3.org/2000/svg"><path d="M0 8L92 3M0 16L92 21" stroke="#9c6c46" stroke-width="5" stroke-linecap="round"/><ellipse cx="87" cy="12" rx="12" ry="6" fill="#fffdf2"/></svg>';
  root.append(menu, toggle, bubble, food, sticks);
  let offset = { x: 0, y: 0 },
    held:
      | {
          id: number;
          x: number;
          y: number;
          start: typeof offset;
          dragged: boolean;
          area: string;
          long: boolean;
        }
      | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined,
    cueTimer: ReturnType<typeof setTimeout> | undefined;
  const cue = (text: string) => {
    bubble.textContent = text;
    bubble.style.display = 'block';
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => (bubble.style.display = 'none'), 1600);
  };
  const play = (kind: AvatarAction) => {
    if (!driver.play(kind)) {
      cue('等我一下～');
      return;
    }
    menu.style.display = 'none';
    cue(
      {
        eat: '开饭！',
        wave: '嗨～',
        stretch: '伸个懒腰',
        pat: '嗯…',
        poke: '诶？',
        lookAround: '让我看看',
        nod: '嗯嗯',
        shake: '唔～',
        wink: '😉',
        smile: '嘿嘿',
      }[kind],
    );
    notify({ type: 'interaction', action: kind });
  };
  food.setAttribute('role', 'button');
  food.setAttribute('aria-label', '再喂一口');
  food.tabIndex = 0;
  food.style.pointerEvents = 'auto';
  food.onclick = () => play('eat');
  food.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      play('eat');
    }
  };
  for (const [label, kind] of [
    ['点点头', 'nod'],
    ['摇摇头', 'shake'],
    ['眨眨眼', 'wink'],
    ['笑一下', 'smile'],
    ['投喂', 'eat'],
    ['招手', 'wave'],
    ['伸懒腰', 'stretch'],
  ] as [string, AvatarAction][]) {
    if (!driver.supports(kind)) continue;
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = buttonStyle;
    b.disabled = !driver.supports(kind);
    if (b.disabled) {
      b.style.opacity = '.45';
      b.title = '这个模型尚未绑定所需手臂参数';
    }
    b.onclick = () => play(kind);
    menu.append(b);
  }
  for (const [label, callback] of [
    ['停一下', () => driver.cancelAction()],
    [
      '归位',
      () => {
        offset = { x: 0, y: 0 };
        driver.cancelAction();
      },
    ],
  ] as [string, () => void][]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = buttonStyle;
    b.onclick = () => {
      callback();
      menu.style.display = 'none';
    };
    menu.append(b);
  }
  toggle.onclick = () => (menu.style.display = menu.style.display === 'none' ? 'flex' : 'none');
  canvas.onpointerdown = (e) => {
    const area = player.hitTest(e.clientX, e.clientY);
    if (!area) return;
    e.preventDefault();
    menu.style.display = 'none';
    held = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: { ...offset },
      dragged: false,
      area,
      long: false,
    };
    canvas.setPointerCapture(e.pointerId);
    timer = setTimeout(() => {
      if (held && !held.dragged) {
        held.long = true;
        menu.style.display = 'flex';
      }
    }, 550);
  };
  canvas.onpointermove = (e) => {
    if (!held || held.id !== e.pointerId) return;
    const dx = e.clientX - held.x,
      dy = e.clientY - held.y;
    if (Math.hypot(dx, dy) > 6) {
      held.dragged = true;
      clearTimeout(timer);
    }
    if (held.dragged) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      offset = dragOffset(held.start, dx, dy, rect.width, rect.height);
      driver.point(
        dx / Math.max(30, rect.width * 0.25),
        -dy / Math.max(30, rect.height * 0.3),
        true,
      );
    }
  };
  const release = (e: PointerEvent, cancel = false) => {
    if (!held || held.id !== e.pointerId) return;
    clearTimeout(timer);
    if (!cancel && !held.dragged && !held.long) play(/head/i.test(held.area) ? 'pat' : 'poke');
    driver.point(0, 0, false);
    held = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.onpointerup = (e) => release(e);
  canvas.onpointercancel = (e) => release(e, true);
  const anchors = new Map<string, { mesh: number; vertex: number }>();
  for (let i = 0; i < player.rt.p2l_mesh_count(player.rig); i++) {
    const name = player.string(player.rt.p2l_mesh_id(player.rig, i));
    if (!/Handwear[LR]$|MouthOpen$/.test(name)) continue;
    const points = new Float32Array(
      player.rt.memory.buffer,
      player.rt.p2l_mesh_vertices(player.rig, i),
      player.meshes[i].vertices * 2,
    );
    let vertex = 0;
    for (let n = 2; n < points.length; n += 2) if (points[n + 1] > points[vertex + 1]) vertex = n;
    anchors.set(name, { mesh: i, vertex });
  }
  const point = (name: string) => {
    const a = anchors.get(name);
    if (!a) return;
    const values = new Float32Array(
        player.rt.memory.buffer,
        player.rt.p2l_mesh_vertices(player.rig, a.mesh),
        player.meshes[a.mesh].vertices * 2,
      ),
      layout = player.layout();
    return {
      x: layout.left + values[a.vertex] * layout.scale,
      y: layout.top + values[a.vertex + 1] * layout.scale,
    };
  };
  return {
    cancel() {
      clearTimeout(timer);
      held = undefined;
      driver.point(0, 0, false);
      menu.style.display = 'none';
    },
    beforeFrame() {
      const r = canvas.getBoundingClientRect();
      player.view.x = offset.x * r.width;
      player.view.y = offset.y * r.height;
    },
    afterFrame() {
      const eating = driver.action()?.kind === 'eat';
      food.style.display = sticks.style.display = eating ? 'block' : 'none';
      if (!eating) return;
      const layout = player.layout(),
        size = Math.max(18, player.width * layout.scale * 0.1),
        left = point('ArtMeshHandwearR'),
        right = point('ArtMeshHandwearL'),
        mouth = point('ArtMeshMouthOpen');
      if (!left) food.style.display = 'none';
      if (!right || !mouth) sticks.style.display = 'none';
      if (left) {
        food.style.width = `${size}px`;
        food.style.left = `${left.x - size * 0.65}px`;
        food.style.top = `${left.y - size * 0.3}px`;
      }
      if (right && mouth) {
        sticks.style.width = `${Math.min(size * 1.6, Math.max(size * 0.7, Math.hypot(mouth.x - right.x, mouth.y - right.y)))}px`;
        sticks.style.left = `${right.x}px`;
        sticks.style.top = `${right.y - size * 0.1}px`;
        sticks.style.transform = `rotate(${Math.atan2(mouth.y - right.y, mouth.x - right.x)}rad)`;
      }
    },
    dispose() {
      clearTimeout(timer);
      clearTimeout(cueTimer);
      driver.point(0, 0, false);
      canvas.onpointerdown =
        canvas.onpointermove =
        canvas.onpointerup =
        canvas.onpointercancel =
          null;
      for (const e of [menu, toggle, bubble, food, sticks]) e.remove();
    },
  };
}
