/* =========================================================
   Kode — Three.js scene
   Low-poly 3D world with character, tiles, decorations.
   Exposes window.GameScene class consumed by app.jsx.
   ========================================================= */
(function () {
  'use strict';

  const TILE_W = 1.4;
  const TILE_H = 0.8;
  const TILE_D = 1.4;
  const TOP_Y = TILE_H; // top surface of a tile

  const COLOR_HEX = {
    red:    0xee5a4f,
    blue:   0x4a9fdb,
    yellow: 0xf2c641,
    green:  0x68c462,
  };
  const COLOR_LIST = ['red', 'blue', 'yellow', 'green'];

  // ---------- helpers ----------
  function vox(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  function mat(color) {
    return new THREE.MeshLambertMaterial({ color });
  }
  function tween(duration, onUpdate, ease = (t) => t) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      function tick(now) {
        const raw = Math.min(1, (now - t0) / duration);
        onUpdate(ease(raw), raw);
        if (raw < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // checker texture for finish tile
  function makeCheckerTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#222';
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if ((x + y) % 2 === 0) ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }

  class GameScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.tiles = [];
      this.tileMeshes = [];
      this.charPos = 0;
      this.celebrationColor = COLOR_HEX.red;
      this.raycaster = new THREE.Raycaster();
      this.pointer = new THREE.Vector2();

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xd9ebb1);
      this.scene.fog = new THREE.Fog(0xd9ebb1, 22, 50);

      // camera
      this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
      this.camera.position.set(7.5, 6.5, 9.5);
      this.camera.lookAt(0, 0.8, 0);

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      // lights
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88a259, 0.55));

      const sun = new THREE.DirectionalLight(0xfff2cc, 1.05);
      sun.position.set(5, 11, 6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const d = 12;
      sun.shadow.camera.left = -d;
      sun.shadow.camera.right = d;
      sun.shadow.camera.top = d;
      sun.shadow.camera.bottom = -d;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 35;
      sun.shadow.bias = -0.0005;
      this.scene.add(sun);

      const fill = new THREE.DirectionalLight(0xb6d6ff, 0.32);
      fill.position.set(-6, 5, -4);
      this.scene.add(fill);

      // materials (shared)
      this.matGrass = mat(0x7fbf5b);
      this.matGrassDark = mat(0x5ea342);
      this.matDirt = mat(0xa07c4a);
      this.matCheckerTop = new THREE.MeshLambertMaterial({ map: makeCheckerTexture() });
      this.matWater = new THREE.MeshLambertMaterial({ color: 0x6cc1d6, transparent: true, opacity: 0.92 });
      this.matStem = mat(0x8b6a3e);

      // groups
      this.tileGroup = new THREE.Group();
      this.scene.add(this.tileGroup);

      this.decoGroup = new THREE.Group();
      this.scene.add(this.decoGroup);

      this.confettiGroup = new THREE.Group();
      this.scene.add(this.confettiGroup);

      // build character
      this.character = this.buildCharacter();
      this.scene.add(this.character.group);

      // ground plane (faint, far behind path)
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 80),
        new THREE.MeshLambertMaterial({ color: 0x9fc56b })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -1.2;
      ground.receiveShadow = true;
      this.scene.add(ground);

      this.buildDecorations();

      this.handleResize();
      window.addEventListener('resize', () => this.handleResize());

      this.t0 = performance.now();
      this.idleTick = 0;
      this.animate = this.animate.bind(this);
      requestAnimationFrame(this.animate);
    }

    // ---------- character ----------
    buildCharacter() {
      const group = new THREE.Group();

      const bodyMat = mat(0xfafafa);
      const innerMat = mat(0xffb7c3);
      const blackMat = mat(0x1d1d1d);
      const noseMat = mat(0xff8aa0);

      // body
      const body = vox(0.6, 0.42, 0.78, bodyMat);
      body.position.set(0, 0.36, -0.05);
      group.add(body);

      // head
      const head = vox(0.5, 0.46, 0.5, bodyMat);
      head.position.set(0, 0.78, 0.4);
      group.add(head);

      // cheek (subtle)
      const cheek = vox(0.52, 0.18, 0.36, bodyMat);
      cheek.position.set(0, 0.62, 0.5);
      group.add(cheek);

      // ears
      const earL = vox(0.1, 0.4, 0.16, bodyMat);
      earL.position.set(-0.15, 1.18, 0.32);
      group.add(earL);
      const earR = earL.clone();
      earR.position.x = 0.15;
      group.add(earR);
      const earInL = vox(0.05, 0.3, 0.05, innerMat);
      earInL.position.set(-0.15, 1.15, 0.4);
      group.add(earInL);
      const earInR = earInL.clone();
      earInR.position.x = 0.15;
      group.add(earInR);

      // eyes
      const eyeL = vox(0.06, 0.08, 0.04, blackMat);
      eyeL.position.set(-0.14, 0.84, 0.66);
      group.add(eyeL);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.14;
      group.add(eyeR);

      // sparkle in eyes
      const sparkleL = vox(0.02, 0.025, 0.01, mat(0xffffff));
      sparkleL.position.set(-0.13, 0.86, 0.68);
      group.add(sparkleL);
      const sparkleR = sparkleL.clone();
      sparkleR.position.x = 0.15;
      group.add(sparkleR);

      // nose
      const nose = vox(0.08, 0.06, 0.05, noseMat);
      nose.position.set(0, 0.7, 0.69);
      group.add(nose);

      // tail
      const tail = vox(0.2, 0.2, 0.18, bodyMat);
      tail.position.set(0, 0.48, -0.5);
      group.add(tail);

      // legs (4)
      const legGeo = new THREE.BoxGeometry(0.16, 0.18, 0.18);
      const legs = [];
      const legPositions = [
        [-0.2, 0.09, 0.28],   // FL
        [ 0.2, 0.09, 0.28],   // FR
        [-0.2, 0.09, -0.3],   // BL
        [ 0.2, 0.09, -0.3],   // BR
      ];
      for (const [x, y, z] of legPositions) {
        const leg = new THREE.Mesh(legGeo, bodyMat);
        leg.position.set(x, y, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        group.add(leg);
        legs.push(leg);
      }

      // paws (front)
      const pawMat = mat(0xf0f0f0);
      const pawL = vox(0.18, 0.12, 0.2, pawMat);
      pawL.position.set(-0.2, 0.06, 0.34);
      group.add(pawL);
      const pawR = pawL.clone();
      pawR.position.x = 0.2;
      group.add(pawR);

      // HAT — color is property; group rotates with character
      const hatMat = mat(COLOR_HEX.red);
      const hat = new THREE.Group();
      const hatBrim = vox(0.46, 0.06, 0.42, hatMat);
      hatBrim.position.set(0, 1.05, 0.38);
      const hatTop = vox(0.34, 0.22, 0.32, hatMat);
      hatTop.position.set(0, 1.18, 0.38);
      const hatPom = vox(0.12, 0.12, 0.12, mat(0xffffff));
      hatPom.position.set(0, 1.35, 0.38);
      hat.add(hatBrim);
      hat.add(hatTop);
      hat.add(hatPom);
      group.add(hat);

      // orient: face +X
      group.rotation.y = Math.PI / 2;

      return {
        group,
        legs,
        front: { l: pawL, r: pawR },
        hat,
        hatMat,
        ear: { l: earL, r: earR, inL: earInL, inR: earInR },
        body,
        head,
        cheek,
        tail,
        eyes: { l: eyeL, r: eyeR, sL: sparkleL, sR: sparkleR },
        nose,
      };
    }

    setHatColor(color) {
      this.character.hatMat.color.setHex(COLOR_HEX[color] || COLOR_HEX.red);
    }

    setCelebrationColor(color) {
      this.celebrationColor = COLOR_HEX[color] || COLOR_HEX.red;
    }

    // ---------- tiles ----------
    tileX(idx) {
      const n = this.tiles.length;
      return (idx - (n - 1) / 2) * TILE_W;
    }

    buildTile(type, color, colorIndex = 0) {
      const g = new THREE.Group();

      if (type === 'gap') {
        // water hole
        const water = vox(TILE_W * 0.92, 0.18, TILE_D * 0.92, this.matWater);
        water.position.y = -0.45;
        water.castShadow = false;
        g.add(water);

        // banks under water (so it doesn't look like a void)
        const bed = vox(TILE_W * 0.92, 0.5, TILE_D * 0.92, mat(0x6e5436));
        bed.position.y = -0.85;
        bed.castShadow = false;
        g.add(bed);

        // little ripple line on top
        const ripple = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_W * 0.6, 0.02, 0.04),
          mat(0xffffff)
        );
        ripple.position.set(0, -0.35, 0.18);
        ripple.castShadow = false;
        g.add(ripple);
        g.userData.ripple = ripple;
      } else {
        // dirt block
        const dirt = vox(TILE_W * 0.96, TILE_H - 0.12, TILE_D * 0.96, this.matDirt);
        dirt.position.y = (TILE_H - 0.12) / 2;
        g.add(dirt);

        // top (grass or checker)
        const topMat = type === 'finish' ? this.matCheckerTop : this.matGrass;
        const top = vox(TILE_W * 0.98, 0.12, TILE_D * 0.98, topMat);
        top.position.y = TILE_H - 0.06;
        g.add(top);

        // grass dark side accent
        const side = vox(TILE_W * 0.98, 0.08, TILE_D * 0.98, this.matGrassDark);
        side.position.y = TILE_H - 0.16;
        g.add(side);

        if (type === 'finish') {
          // flag pole
          const pole = vox(0.06, 1.1, 0.06, this.matStem);
          pole.position.set(0.35, TOP_Y + 0.55, -0.3);
          g.add(pole);
          const flag = vox(0.45, 0.3, 0.05, mat(0xee5a4f));
          flag.position.set(0.6, TOP_Y + 0.85, -0.3);
          g.add(flag);
        }

        if (type === 'wheel') {
          // stem
          const stem = vox(0.18, 0.32, 0.18, this.matStem);
          stem.position.set(0, TOP_Y + 0.18, -0.05);
          g.add(stem);

          const frame = new THREE.Group();
          frame.position.set(0, TOP_Y + 0.72, -0.05);
          g.add(frame);

          const rim = new THREE.Mesh(
            new THREE.CylinderGeometry(0.47, 0.47, 0.08, 8),
            mat(0xfff6cf)
          );
          rim.rotation.x = Math.PI / 2;
          rim.castShadow = true;
          rim.receiveShadow = true;
          frame.add(rim);

          const wheel = new THREE.Group();
          const segmentPositions = [
            [0, 0.18, 0],
            [0.18, 0, 0],
            [0, -0.18, 0],
            [-0.18, 0, 0],
          ];
          COLOR_LIST.forEach((name, i) => {
            const seg = vox(0.3, 0.3, 0.1, mat(COLOR_HEX[name]));
            seg.position.set(...segmentPositions[i]);
            seg.rotation.z = Math.PI / 4;
            wheel.add(seg);
          });
          wheel.rotation.z = colorIndex * Math.PI / 2;
          frame.add(wheel);

          const hub = vox(0.16, 0.16, 0.14, mat(0xffffff));
          hub.position.z = 0.08;
          frame.add(hub);

          const pointer = new THREE.Mesh(
            new THREE.ConeGeometry(0.08, 0.18, 4),
            mat(0x33281b)
          );
          pointer.position.set(0, 0.58, 0.08);
          pointer.rotation.z = Math.PI;
          pointer.castShadow = true;
          frame.add(pointer);

          const selectedMat = mat(COLOR_HEX[color]);
          const selected = vox(0.24, 0.1, 0.16, selectedMat);
          selected.position.set(0, -0.62, 0.05);
          frame.add(selected);

          g.userData.wheel = wheel;
          g.userData.wheelFrame = frame;
          g.userData.selectedMat = selectedMat;
        }
      }

      return g;
    }

    rebuildLevel(tiles) {
      // clear old
      while (this.tileGroup.children.length) {
        const c = this.tileGroup.children.pop();
        c.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
        });
      }
      this.tileMeshes = [];
      this.tiles = tiles;

      tiles.forEach((t, i) => {
        const g = this.buildTile(t.type, t.color, t.colorIndex || 0);
        g.position.x = this.tileX(i);
        g.userData.tileIndex = i;
        g.traverse((o) => { o.userData.tileIndex = i; });
        this.tileGroup.add(g);
        this.tileMeshes.push(g);
      });

      // place character on first tile
      this.charPos = 0;
      const g = this.character.group;
      g.position.set(this.tileX(0), TOP_Y, 0);
      g.rotation.y = Math.PI / 2; // face +X (forward)
    }

    updateWheelColor(idx, color) {
      const m = this.tileMeshes[idx];
      if (m && m.userData.selectedMat) {
        m.userData.selectedMat.color.setHex(COLOR_HEX[color]);
      }
    }

    pickTileAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.tileGroup.children, true);
      for (const hit of hits) {
        let obj = hit.object;
        while (obj) {
          if (obj.userData && obj.userData.tileIndex != null) return obj.userData.tileIndex;
          obj = obj.parent;
        }
      }
      return null;
    }

    // ---------- decorations ----------
    buildDecorations() {
      const trees = [
        { x: -6.5, z: -3.2, scale: 1.0 },
        { x:  5.5, z: -3.8, scale: 1.2 },
        { x:  7.5, z:  3.0, scale: 0.9 },
        { x: -7.2, z:  3.5, scale: 1.1 },
        { x: -2.0, z: -4.5, scale: 0.75 },
        { x:  2.5, z: -4.8, scale: 0.85 },
      ];
      for (const t of trees) {
        this.decoGroup.add(this.buildTree(t.x, t.z, t.scale));
      }

      const rocks = [
        { x: -4.8, z:  2.6, c: 0xb6b09a },
        { x:  6.2, z:  2.2, c: 0xa39d87 },
        { x: -3.2, z:  3.2, c: 0xc8c2ad },
      ];
      for (const r of rocks) this.decoGroup.add(this.buildRock(r.x, r.z, r.c));

      // tufts of grass
      for (let i = 0; i < 14; i++) {
        const tuft = vox(0.15, 0.18, 0.15, this.matGrassDark);
        tuft.position.set(
          (Math.random() * 16 - 8),
          -1.05,
          (Math.random() * 8 - 4) * (Math.random() > 0.5 ? 1 : -1)
        );
        // keep tufts off path
        if (Math.abs(tuft.position.z) < 1.4) tuft.position.z += 1.8 * Math.sign(tuft.position.z || 1);
        this.decoGroup.add(tuft);
      }

      // clouds (drift)
      this.clouds = [];
      for (let i = 0; i < 3; i++) {
        const c = this.buildCloud();
        c.position.set(-8 + i * 8, 7 + Math.random() * 2, -10 - Math.random() * 3);
        this.decoGroup.add(c);
        this.clouds.push(c);
      }
    }

    buildTree(x, z, scale = 1) {
      const g = new THREE.Group();
      const trunk = vox(0.32, 0.9, 0.32, this.matStem);
      trunk.position.y = 0.45 - 1.2;
      g.add(trunk);
      const greens = [0x4f9c46, 0x5cb158, 0x71c46a];
      const layers = [
        { y: 0.0, s: 1.2 },
        { y: 0.7, s: 0.9 },
        { y: 1.3, s: 0.6 },
      ];
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(L.s, 0.9, 6),
          mat(greens[i % greens.length])
        );
        cone.position.y = L.y - 0.2;
        cone.castShadow = true;
        cone.receiveShadow = true;
        g.add(cone);
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(scale);
      return g;
    }

    buildRock(x, z, color) {
      const g = new THREE.Group();
      const r1 = vox(0.6, 0.35, 0.55, mat(color));
      r1.position.set(0, -0.95, 0);
      g.add(r1);
      const r2 = vox(0.35, 0.25, 0.32, mat(color));
      r2.position.set(0.35, -1.0, 0.2);
      g.add(r2);
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * Math.PI * 2;
      return g;
    }

    buildCloud() {
      const g = new THREE.Group();
      const m = mat(0xffffff);
      const a = vox(1.2, 0.5, 0.8, m);
      const b = vox(0.8, 0.4, 0.6, m);
      b.position.set(0.7, 0.05, 0.1);
      const c = vox(0.6, 0.3, 0.5, m);
      c.position.set(-0.7, -0.05, -0.1);
      g.add(a); g.add(b); g.add(c);
      g.traverse(o => { if (o.isMesh) o.castShadow = false; });
      return g;
    }

    // ---------- camera / sizing ----------
    handleResize() {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      const wide = w / h > 1.25;
      this.camera.position.set(
        wide ? 9.9 : 10.7,
        wide ? 7.3 : 8.1,
        wide ? 12.4 : 13.4
      );
      this.camera.lookAt(0, -0.15, 0);
      this.camera.updateProjectionMatrix();
    }

    // ---------- core animations ----------
    animate(now) {
      requestAnimationFrame(this.animate);
      const t = (now - this.t0) / 1000;

      // idle breathing
      if (!this.busy) {
        const idle = Math.sin(t * 2.5) * 0.018;
        this.character.body.scale.y = 1 + idle;
        this.character.head.position.y = 0.78 + idle * 0.5;
        this.character.ear.l.rotation.z = Math.sin(t * 1.8) * 0.05;
        this.character.ear.r.rotation.z = -Math.sin(t * 1.8 + 0.3) * 0.05;
      }

      // wheel subtle bob
      for (const m of this.tileMeshes) {
        if (m.userData.wheelFrame) {
          m.userData.wheelFrame.position.y = TOP_Y + 0.72 + Math.sin(t * 1.8 + m.position.x) * 0.035;
        }
        if (m.userData.ripple) {
          m.userData.ripple.position.x = Math.sin(t * 1.2 + m.position.x) * 0.3;
        }
      }

      // clouds drift
      if (this.clouds) {
        for (const c of this.clouds) {
          c.position.x += 0.003;
          if (c.position.x > 12) c.position.x = -12;
        }
      }

      // confetti
      for (let i = this.confettiGroup.children.length - 1; i >= 0; i--) {
        const p = this.confettiGroup.children[i];
        p.userData.life -= 0.016;
        p.position.add(p.userData.vel);
        p.userData.vel.y -= 0.014;
        p.rotation.x += p.userData.rotS;
        p.rotation.z += p.userData.rotS * 0.7;
        if (p.userData.life <= 0) {
          this.confettiGroup.remove(p);
          p.geometry.dispose();
          p.material.dispose();
        }
      }

      this.renderer.render(this.scene, this.camera);
    }

    // promise-based action animations
    async walkTo(toIdx) {
      this.busy = true;
      const fromX = this.character.group.position.x;
      const toX = this.tileX(toIdx);
      const fromY = this.character.group.position.y;
      await tween(440, (t) => {
        const x = fromX + (toX - fromX) * t;
        // small hop arc
        const hop = Math.sin(t * Math.PI) * 0.18;
        this.character.group.position.x = x;
        this.character.group.position.y = fromY + hop;
        // legs swing
        const swing = Math.sin(t * Math.PI * 4) * 0.12;
        this.character.legs[0].position.z =  0.28 + swing;
        this.character.legs[1].position.z =  0.28 - swing;
        this.character.legs[2].position.z = -0.3  - swing;
        this.character.legs[3].position.z = -0.3  + swing;
        this.character.front.l.position.z = 0.34 + swing;
        this.character.front.r.position.z = 0.34 - swing;
      }, easeInOut);
      // reset leg z
      this.character.legs[0].position.z = 0.28;
      this.character.legs[1].position.z = 0.28;
      this.character.legs[2].position.z = -0.3;
      this.character.legs[3].position.z = -0.3;
      this.character.front.l.position.z = 0.34;
      this.character.front.r.position.z = 0.34;
      this.charPos = toIdx;
      this.busy = false;
    }

    async jumpTo(toIdx) {
      this.busy = true;
      const fromX = this.character.group.position.x;
      const toX = this.tileX(toIdx);
      const fromY = this.character.group.position.y;
      await tween(720, (t) => {
        const x = fromX + (toX - fromX) * t;
        const arc = Math.sin(t * Math.PI) * 1.1;
        this.character.group.position.x = x;
        this.character.group.position.y = fromY + arc;
        // tuck legs
        const tuck = Math.sin(t * Math.PI) * 0.06;
        this.character.legs.forEach(l => l.position.y = 0.09 + tuck);
        this.character.front.l.position.y = 0.06 + tuck;
        this.character.front.r.position.y = 0.06 + tuck;
        // tilt body forward then back
        this.character.group.rotation.z = Math.sin(t * Math.PI) * 0.0;
        this.character.group.rotation.x = Math.sin(t * Math.PI) * 0.15;
      }, easeOut);
      this.character.legs.forEach(l => l.position.y = 0.09);
      this.character.front.l.position.y = 0.06;
      this.character.front.r.position.y = 0.06;
      this.character.group.rotation.x = 0;
      this.charPos = toIdx;
      this.busy = false;
    }

    async fall(toIdx) {
      // fail anim: character falls into gap
      this.busy = true;
      const fromX = this.character.group.position.x;
      const toX = this.tileX(toIdx);
      await tween(700, (t) => {
        this.character.group.position.x = fromX + (toX - fromX) * t;
        // up then plummet
        if (t < 0.4) {
          this.character.group.position.y = Math.sin((t / 0.4) * Math.PI * 0.5) * 0.3;
        } else {
          const fall = (t - 0.4) / 0.6;
          this.character.group.position.y = 0.3 - fall * fall * 1.8;
          this.character.group.rotation.x = fall * Math.PI * 0.5;
        }
      });
      this.busy = false;
    }

    async spinWheel(idx, nextColor, nextIndex) {
      this.busy = true;
      const tile = this.tileMeshes[idx];
      if (!tile || !tile.userData.wheel) {
        this.busy = false;
        return;
      }
      const wheel = tile.userData.wheel;
      const startZ = wheel.rotation.z;
      const targetZ = nextIndex == null ? startZ + Math.PI / 2 : nextIndex * Math.PI / 2;
      const spinZ = targetZ <= startZ ? targetZ + Math.PI * 2 : targetZ;

      // pre: little paw raise
      await tween(160, (t) => {
        this.character.front.r.position.y = 0.06 + t * 0.18;
        this.character.front.r.position.z = 0.34 + t * 0.18;
        this.character.group.rotation.y = Math.PI / 2 - t * 0.12;
      }, easeOut);

      // strike + wheel spin, color swap mid-spin
      await tween(420, (t) => {
        wheel.rotation.z = startZ + (spinZ - startZ) * t;
        // paw slap
        const slap = Math.sin(t * Math.PI) * 0.3;
        this.character.front.r.position.x = 0 - slap * 0.05;
        if (t > 0.5 && !this._swapped) {
          this._swapped = true;
          tile.userData.selectedMat.color.setHex(COLOR_HEX[nextColor]);
        }
      }, easeInOut);
      this._swapped = false;
      wheel.rotation.z = targetZ;

      // recover
      await tween(180, (t) => {
        this.character.front.r.position.y = 0.24 - t * 0.18;
        this.character.front.r.position.z = 0.52 - t * 0.18;
        this.character.group.rotation.y = Math.PI / 2 - 0.12 + t * 0.12;
      });
      this.character.group.rotation.y = Math.PI / 2;
      this.busy = false;
    }

    async celebrate() {
      this.busy = true;
      // confetti burst
      const palette = [this.celebrationColor, 0xf2c641, 0x68c462, 0x4a9fdb, 0x8c63d6, 0xffffff];
      for (let i = 0; i < 60; i++) {
        const p = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.08, 0.08),
          mat(palette[i % palette.length])
        );
        const pos = this.character.group.position;
        p.position.set(pos.x, pos.y + 1.4, pos.z);
        p.userData.vel = new THREE.Vector3(
          (Math.random() - 0.5) * 0.18,
          0.18 + Math.random() * 0.1,
          (Math.random() - 0.5) * 0.18
        );
        p.userData.rotS = (Math.random() - 0.5) * 0.3;
        p.userData.life = 1.6 + Math.random() * 0.4;
        this.confettiGroup.add(p);
      }
      // 3 hops in place
      for (let i = 0; i < 3; i++) {
        const sx = this.character.group.position.x;
        const sy = this.character.group.position.y;
        await tween(280, (t) => {
          this.character.group.position.y = sy + Math.sin(t * Math.PI) * 0.5;
          this.character.group.rotation.y = Math.PI / 2 + Math.sin(t * Math.PI * 2) * 0.3;
        }, easeOut);
        this.character.group.position.y = sy;
        this.character.group.rotation.y = Math.PI / 2;
      }
      this.busy = false;
    }

    async shake() {
      this.busy = true;
      const sx = this.character.group.position.x;
      const sy = this.character.group.position.y;
      await tween(380, (t) => {
        this.character.group.position.x = sx + Math.sin(t * Math.PI * 8) * 0.08;
        this.character.group.rotation.z = Math.sin(t * Math.PI * 8) * 0.1;
      });
      this.character.group.position.x = sx;
      this.character.group.rotation.z = 0;
      this.busy = false;
    }
  }

  window.GameScene = GameScene;
  window.KODE = { TILE_W, TILE_H, COLOR_LIST, COLOR_HEX };
})();
