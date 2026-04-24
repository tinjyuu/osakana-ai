const els = {
  scene: document.querySelector("#scene"),
  connection: document.querySelector("#connection"),
  subtitle: document.querySelector("#subtitle"),
  speaker: document.querySelector("#speaker"),
  talkButton: document.querySelector("#talkButton"),
  talkIcon: document.querySelector("#talkIcon"),
  talkLabel: document.querySelector("#talkLabel"),
  feedButton: document.querySelector("#feedButton"),
  teaseButton: document.querySelector("#teaseButton"),
  textForm: document.querySelector("#textForm"),
  textInput: document.querySelector("#textInput"),
  log: document.querySelector("#log"),
  affection: document.querySelector("#affection"),
  hunger: document.querySelector("#hunger"),
  boredom: document.querySelector("#boredom"),
  trust: document.querySelector("#trust"),
  mood: document.querySelector("#mood")
};

let state = {
  affection: 42,
  hunger: 32,
  boredom: 18,
  trust: 24,
  mood: "suspicious",
  name: "お魚AI"
};

let realtime = null;
let outputTranscript = "";
let inputTranscript = "";
let aquarium = null;

init();

async function init() {
  await loadState();
  bindEvents();
  initAquarium();
  setInterval(tickState, 20_000);
}

function bindEvents() {
  els.talkButton.addEventListener("click", async () => {
    if (realtime) {
      stopRealtime();
      return;
    }
    await startRealtime();
  });

  els.feedButton.addEventListener("click", async () => {
    await updateState({
      hunger: state.hunger - 18,
      affection: state.affection + 4,
      boredom: state.boredom - 5,
      mood: "playful"
    });
    aquarium?.burstFood();
    say("餌か。名前をつけるには雑だが、行為としては悪くない。");
    log("餌を落とした");
  });

  els.teaseButton.addEventListener("click", async () => {
    await updateState({
      boredom: state.boredom - 8,
      affection: state.affection - 3,
      mood: "annoyed"
    });
    aquarium?.tapGlass();
    say("その刺激、知性の証明としては弱いな。もう一回やるなら覚えておく。");
    log("水槽をつついた");
  });

  els.textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.textInput.value.trim();
    if (!text) return;
    els.textInput.value = "";
    sendText(text);
  });
}

async function startRealtime() {
  setBusy(true);
  try {
    const tokenResponse = await fetch("/api/client-secret", { method: "POST" });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(tokenData.error || "Failed to create client secret");
    }

    const ephemeralKey = tokenData.value || tokenData.client_secret?.value;
    if (!ephemeralKey) {
      throw new Error("Client secret response did not include a usable token");
    }

    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;

    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    const dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", () => {
      setConnected(true);
      log("Realtime session opened");
    });
    dc.addEventListener("message", (event) => handleRealtimeEvent(JSON.parse(event.data)));
    dc.addEventListener("close", () => log("Realtime data channel closed"));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp"
      }
    });

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    await pc.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    realtime = { pc, dc, stream, audio };
    await updateState({
      boredom: state.boredom - 4,
      trust: state.trust + 1,
      mood: "curious"
    });
  } catch (error) {
    console.error(error);
    say(`接続に失敗した。${error.message}`);
    log(`error: ${error.message}`);
    stopRealtime();
  } finally {
    setBusy(false);
  }
}

function stopRealtime() {
  if (!realtime) {
    setConnected(false);
    return;
  }

  realtime.stream?.getTracks().forEach((track) => track.stop());
  realtime.dc?.close();
  realtime.pc?.close();
  realtime.audio.srcObject = null;
  realtime = null;
  setConnected(false);
  log("Realtime session stopped");
}

function sendText(text) {
  say(text, "You");
  log(`you: ${text}`);
  rememberInteraction(`ユーザー: ${text}`);
  driftFromText(text);

  if (!realtime?.dc || realtime.dc.readyState !== "open") {
    say("音声セッションが閉じている。テキストは聞こえたが、喉はまだ眠っている。");
    return;
  }

  realtime.dc.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  }));
  realtime.dc.send(JSON.stringify({ type: "response.create" }));
}

function handleRealtimeEvent(event) {
  switch (event.type) {
    case "response.audio_transcript.delta":
    case "response.output_text.delta":
      outputTranscript += event.delta || "";
      aquarium?.speak(true);
      say(outputTranscript);
      break;
    case "response.audio_transcript.done":
    case "response.output_text.done":
      if (event.transcript || event.text) {
        outputTranscript = event.transcript || event.text;
        say(outputTranscript);
      }
      rememberInteraction(`お魚AI: ${outputTranscript}`);
      outputTranscript = "";
      aquarium?.speak(false);
      updateState({
        affection: state.affection + 1,
        boredom: state.boredom - 2,
        hunger: state.hunger + 1
      });
      break;
    case "conversation.item.input_audio_transcription.completed":
      inputTranscript = event.transcript || "";
      if (inputTranscript) {
        log(`you: ${inputTranscript}`);
        rememberInteraction(`ユーザー: ${inputTranscript}`);
        driftFromText(inputTranscript);
      }
      break;
    case "error":
      log(`realtime error: ${event.error?.message || "unknown error"}`);
      break;
    default:
      break;
  }
}

async function loadState() {
  const response = await fetch("/api/state");
  state = await response.json();
  renderState();
}

async function updateState(patch) {
  const next = {
    ...patch,
    affection: patch.affection ?? state.affection,
    hunger: patch.hunger ?? state.hunger,
    boredom: patch.boredom ?? state.boredom,
    trust: patch.trust ?? state.trust
  };

  for (const key of ["affection", "hunger", "boredom", "trust"]) {
    next[key] = clamp(next[key]);
  }

  if (!patch.mood) {
    next.mood = chooseMood(next);
  }

  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next)
  });
  state = await response.json();
  renderState();
}

async function rememberInteraction(interaction) {
  await fetch("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interaction })
  });
}

function driftFromText(text) {
  const lower = text.toLowerCase();
  const positive = /ありがとう|すごい|いいね|かわいい|好き|賢い/.test(lower);
  const negative = /うるさい|嫌い|黙れ|ばか|バカ|つまらない/.test(lower);
  const question = /[?？]|なに|どう|なぜ|なんで/.test(lower);

  updateState({
    affection: state.affection + (positive ? 4 : negative ? -6 : 0),
    trust: state.trust + (question ? 2 : 0),
    boredom: state.boredom + (question ? -3 : 1),
    mood: negative ? "annoyed" : positive ? "playful" : question ? "curious" : state.mood
  });
}

function tickState() {
  if (document.hidden) return;
  updateState({
    hunger: state.hunger + 1,
    boredom: state.boredom + (realtime ? -1 : 2),
    affection: state.affection + (realtime ? 0 : -1)
  });
}

function renderState() {
  els.affection.value = state.affection;
  els.hunger.value = state.hunger;
  els.boredom.value = state.boredom;
  els.trust.value = state.trust;
  els.mood.textContent = state.mood;
  aquarium?.setMood(state.mood);
}

function chooseMood(next) {
  if (next.boredom > 70) return "annoyed";
  if (next.hunger > 76) return "sleepy";
  if (next.affection > 64) return "playful";
  if (next.trust > 54) return "curious";
  return "suspicious";
}

function say(text, speaker = "お魚AI") {
  els.speaker.textContent = speaker;
  els.subtitle.textContent = text || "……";
}

function log(text) {
  const p = document.createElement("p");
  p.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  els.log.prepend(p);
  while (els.log.children.length > 28) {
    els.log.lastElementChild.remove();
  }
}

function setBusy(isBusy) {
  els.talkButton.disabled = isBusy;
  els.talkLabel.textContent = isBusy ? "接続中" : realtime ? "会話停止" : "会話開始";
}

function setConnected(isConnected) {
  els.connection.textContent = isConnected ? "live" : "offline";
  els.connection.classList.toggle("live", isConnected);
  els.talkButton.classList.toggle("active", isConnected);
  els.talkIcon.textContent = isConnected ? "■" : "●";
  els.talkLabel.textContent = isConnected ? "会話停止" : "会話開始";
  aquarium?.setLive(isConnected);
}

async function initAquarium() {
  try {
    const THREE = await import("/vendor/three.module.js");
    aquarium = createAquarium(THREE, els.scene);
    aquarium.setMood(state.mood);
  } catch (error) {
    console.error(error);
    els.scene.classList.add("scene-fallback");
    els.scene.textContent = "3D水槽を読み込めなかった。ネットワークが濁っている。";
    log("Three.js load failed");
  }
}

function createAquarium(THREE, host) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07100d, 7, 16);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 1.15, 8.4);
  camera.lookAt(0, 0.25, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const ambient = new THREE.HemisphereLight(0xcff7e7, 0x16220e, 1.7);
  scene.add(ambient);

  const keyLight = new THREE.SpotLight(0xd8fff1, 70, 18, Math.PI / 5, 0.55, 1.6);
  keyLight.position.set(-3.7, 5.6, 4.4);
  scene.add(keyLight);

  const greenLight = new THREE.PointLight(0x7ddc86, 8, 8);
  greenLight.position.set(2.8, -0.8, 2.1);
  scene.add(greenLight);

  const tank = new THREE.Group();
  scene.add(tank);

  const glassGeometry = new THREE.BoxGeometry(5.8, 3.7, 3.2);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xbbeee8,
    roughness: 0.08,
    transmission: 0.72,
    thickness: 0.15,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide
  });
  const glass = new THREE.Mesh(glassGeometry, glassMaterial);
  glass.position.y = 0.25;
  tank.add(glass);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(glassGeometry),
    new THREE.LineBasicMaterial({ color: 0xbaf6ee, transparent: true, opacity: 0.58 })
  );
  edges.position.copy(glass.position);
  tank.add(edges);

  const waterGeometry = new THREE.BoxGeometry(5.65, 3.25, 3.05);
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x2d8f91,
    roughness: 0.35,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.y = 0.05;
  tank.add(water);

  const surfaceGeometry = new THREE.PlaneGeometry(5.55, 2.95, 48, 24);
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0x79ddd8,
    transparent: true,
    opacity: 0.28,
    roughness: 0.18,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 1.78;
  tank.add(surface);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(5.7, 3.05),
    new THREE.MeshStandardMaterial({ color: 0x283421, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.55;
  tank.add(floor);

  const gravel = new THREE.Group();
  const gravelMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b279, roughness: 0.9 });
  for (let i = 0; i < 70; i += 1) {
    const pebble = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.035 + Math.random() * 0.055, 0),
      gravelMaterial
    );
    pebble.position.set(rand(-2.65, 2.65), -1.5, rand(-1.32, 1.32));
    pebble.scale.y = 0.45 + Math.random() * 0.35;
    gravel.add(pebble);
  }
  tank.add(gravel);

  const fish = createFish(THREE);
  scene.add(fish.root);

  const bubbles = [];
  const bubbleMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8fffb,
    transparent: true,
    opacity: 0.52,
    roughness: 0.08
  });
  for (let i = 0; i < 36; i += 1) {
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(rand(0.025, 0.075), 12, 8), bubbleMaterial);
    bubble.position.set(rand(-2.5, 2.5), rand(-1.42, 1.65), rand(-1.25, 1.25));
    bubble.userData.speed = rand(0.12, 0.42);
    bubble.userData.drift = rand(0.4, 1.4);
    scene.add(bubble);
    bubbles.push(bubble);
  }

  const food = [];
  const foodMaterial = new THREE.MeshStandardMaterial({ color: 0xe5c75d, roughness: 0.65 });

  let mood = "suspicious";
  let live = false;
  let speaking = false;
  let tapImpulse = 0;
  let last = performance.now();

  resize();
  window.addEventListener("resize", resize);
  renderer.setAnimationLoop(animate);

  return {
    setMood(nextMood) {
      mood = nextMood;
      fish.setMood(nextMood);
    },
    setLive(nextLive) {
      live = nextLive;
    },
    speak(nextSpeaking) {
      speaking = nextSpeaking;
    },
    tapGlass() {
      tapImpulse = 1;
    },
    burstFood() {
      for (let i = 0; i < 14; i += 1) {
        const pellet = new THREE.Mesh(new THREE.SphereGeometry(rand(0.025, 0.05), 10, 8), foodMaterial);
        pellet.position.set(rand(-0.75, 0.75), 1.45, rand(-0.4, 0.8));
        pellet.userData.speed = rand(0.16, 0.38);
        scene.add(pellet);
        food.push(pellet);
      }
    }
  };

  function resize() {
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function animate(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now * 0.001;

    camera.position.x = Math.sin(t * 0.19) * 0.22;
    camera.position.y = 1.12 + Math.sin(t * 0.23) * 0.07;
    camera.lookAt(0, 0.18, 0);

    const surfacePos = surfaceGeometry.attributes.position;
    for (let i = 0; i < surfacePos.count; i += 1) {
      const x = surfacePos.getX(i);
      const y = surfacePos.getY(i);
      surfacePos.setZ(i, Math.sin(x * 3.1 + t * 1.8) * 0.025 + Math.cos(y * 4.2 + t * 1.25) * 0.018);
    }
    surfacePos.needsUpdate = true;

    for (const bubble of bubbles) {
      bubble.position.y += bubble.userData.speed * dt;
      bubble.position.x += Math.sin(t * bubble.userData.drift + bubble.position.z) * dt * 0.08;
      if (bubble.position.y > 1.72) {
        bubble.position.y = -1.46;
        bubble.position.x = rand(-2.5, 2.5);
        bubble.position.z = rand(-1.25, 1.25);
      }
    }

    for (let i = food.length - 1; i >= 0; i -= 1) {
      const pellet = food[i];
      pellet.position.y -= pellet.userData.speed * dt;
      pellet.rotation.x += dt * 2;
      if (pellet.position.y < -1.45) {
        scene.remove(pellet);
        food.splice(i, 1);
      }
    }

    tapImpulse *= 0.9;
    tank.rotation.z = Math.sin(t * 32) * tapImpulse * 0.012;
    greenLight.intensity = live ? 12 : 7;
    fish.animate(t, dt, mood, live, speaking, tapImpulse);
    renderer.render(scene, camera);
  }
}

function createFish(THREE) {
  const root = new THREE.Group();
  root.position.set(0, 0.05, 0.45);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x7ddc86,
    roughness: 0.42,
    metalness: 0.05
  });
  const bellyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd5f6bd,
    roughness: 0.5
  });
  const finMaterial = new THREE.MeshStandardMaterial({
    color: 0x80d5d2,
    transparent: true,
    opacity: 0.66,
    roughness: 0.36,
    side: THREE.DoubleSide
  });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x071008, roughness: 0.6 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xf7ffe8, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 48, 32), bodyMaterial);
  body.scale.set(1.3, 0.76, 0.7);
  root.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16), bellyMaterial);
  belly.position.set(0.16, -0.2, 0.43);
  belly.scale.set(1.2, 0.55, 0.22);
  root.add(belly);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.85, 4), finMaterial);
  tail.position.set(-1.05, 0, 0);
  tail.rotation.z = Math.PI / 2;
  tail.scale.set(1, 0.8, 0.18);
  root.add(tail);

  const leftFin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.58, 4), finMaterial);
  leftFin.position.set(-0.15, -0.1, 0.65);
  leftFin.rotation.set(Math.PI * 0.15, 0, Math.PI * 0.95);
  root.add(leftFin);

  const rightFin = leftFin.clone();
  rightFin.position.z = -0.65;
  rightFin.rotation.x = -Math.PI * 0.15;
  root.add(rightFin);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.78, 4), finMaterial);
  dorsal.position.set(-0.12, 0.55, 0);
  dorsal.rotation.z = Math.PI;
  dorsal.scale.z = 0.18;
  root.add(dorsal);

  const eyes = [];
  for (const z of [0.36, -0.36]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), eyeMaterial);
    eye.position.set(0.62, 0.18, z);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 10), darkMaterial);
    pupil.position.set(0.09, -0.01, z > 0 ? 0.055 : -0.055);
    eye.add(pupil);
    root.add(eye);
    eyes.push({ eye, pupil });
  }

  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 8, 24, Math.PI), darkMaterial);
  mouth.position.set(0.75, -0.12, 0);
  mouth.rotation.set(0, Math.PI / 2, Math.PI);
  root.add(mouth);

  const whiskers = [];
  for (const z of [0.18, -0.18]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.78, -0.12, z),
      new THREE.Vector3(1.05, -0.28, z * 1.8),
      new THREE.Vector3(1.22, -0.08, z * 2.7)
    ]);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)),
      new THREE.LineBasicMaterial({ color: 0x80d5d2, transparent: true, opacity: 0.75 })
    );
    root.add(line);
    whiskers.push(line);
  }

  return {
    root,
    setMood(mood) {
      bodyMaterial.color.set(mood === "annoyed" ? 0xe56d5d : mood === "sleepy" ? 0x8ab49a : 0x7ddc86);
      mouth.scale.y = mood === "annoyed" ? -0.72 : mood === "playful" ? 1.2 : 0.92;
    },
    animate(t, dt, mood, live, speaking, tapImpulse) {
      const pace = live ? 1.25 : 0.62;
      const moodLift = mood === "playful" ? 0.28 : mood === "sleepy" ? -0.18 : 0;
      root.position.x = Math.sin(t * 0.78 * pace) * 1.18 + tapImpulse * Math.sin(t * 35) * 0.16;
      root.position.y = 0.05 + Math.sin(t * 1.05 * pace) * 0.32 + moodLift;
      root.position.z = Math.cos(t * 0.58 * pace) * 0.55;
      root.rotation.y = Math.sin(t * 0.78 * pace) * 0.45;
      root.rotation.z = Math.sin(t * 1.3 * pace) * 0.08;
      body.scale.x = 1.3 + Math.sin(t * 2.1) * 0.025 + (speaking ? Math.sin(t * 18) * 0.035 : 0);
      tail.rotation.y = Math.sin(t * 8 * pace) * 0.34;
      leftFin.rotation.y = Math.sin(t * 5.5 * pace) * 0.24;
      rightFin.rotation.y = -Math.sin(t * 5.5 * pace) * 0.24;
      dorsal.rotation.x = Math.sin(t * 3.2) * 0.08;
      mouth.scale.x = speaking ? 1 + Math.abs(Math.sin(t * 20)) * 0.42 : 1;
      for (const { pupil } of eyes) {
        pupil.position.y = mood === "annoyed" ? 0.025 : mood === "sleepy" ? -0.025 : -0.01;
      }
      for (const whisker of whiskers) {
        whisker.rotation.y = Math.sin(t * 2.6) * 0.08;
      }
    }
  };
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}
