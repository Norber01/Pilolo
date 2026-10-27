// Keyboard + mouse on computers, virtual joystick + buttons on phones.
export class Controls {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.move = { x: 0, y: 0 };
    this.touchMove = null;
    this.jumpQueued = false;
    this.actionQueued = false;
    this.sprintToggle = false;
    this.enabled = true;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', this.isTouch);

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'KeyF') this.actionQueued = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // Mouse look: pointer lock when available, drag otherwise.
    let dragging = false;
    canvas.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      dragging = true;
      if (this.enabled && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
    addEventListener('mouseup', () => (dragging = false));
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || dragging) {
        this.look.x += e.movementX * 0.0025;
        this.look.y += e.movementY * 0.0025;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    // Touch: left half = joystick, right half = camera.
    const stick = ui.stick, knob = ui.knob;
    const touches = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const left = e.clientX < innerWidth * 0.45;
      touches.set(e.pointerId, { kind: left && !this.touchMove ? 'move' : 'look', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
      if (left && !this.touchMove) {
        this.touchMove = e.pointerId;
        stick.style.display = 'block';
        stick.style.left = e.clientX - 60 + 'px';
        stick.style.top = e.clientY - 60 + 'px';
        knob.style.transform = 'translate(0px,0px)';
      }
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      if (t.kind === 'look') {
        this.look.x += (e.clientX - t.x) * 0.006;
        this.look.y += (e.clientY - t.y) * 0.006;
      } else {
        let dx = e.clientX - t.ox, dy = e.clientY - t.oy;
        const d = Math.hypot(dx, dy), max = 50;
        if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        this.move.x = dx / max;
        this.move.y = -dy / max;
        this.stickSprint = d > max * 1.6;
      }
      t.x = e.clientX; t.y = e.clientY;
    });
    const end = (e) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      touches.delete(e.pointerId);
      if (t.kind === 'move') {
        this.touchMove = null;
        this.move.x = this.move.y = 0;
        this.stickSprint = false;
        stick.style.display = 'none';
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    tap(ui.btnJump, () => (this.jumpQueued = true));
    tap(ui.btnAction, () => (this.actionQueued = true));
    tap(ui.btnSprint, () => {
      this.sprintToggle = !this.sprintToggle;
      ui.btnSprint.classList.toggle('on', this.sprintToggle);
    });
  }

  /** Returns the movement intent for this frame (x = right, y = forward). */
  read() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (this.touchMove != null) { x = this.move.x; y = this.move.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.sprintToggle || this.stickSprint;
    const out = { x, y, sprint, jump: this.jumpQueued, action: this.actionQueued, lookX: this.look.x, lookY: this.look.y, zoom: this.zoom };
    this.jumpQueued = this.actionQueued = false;
    this.look.x = this.look.y = 0;
    this.zoom = 0;
    if (!this.enabled) { out.x = out.y = 0; out.jump = out.action = false; }
    return out;
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
