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
  mood: document.querySelector("#mood"),
  mailForm: document.querySelector("#mailForm"),
  mailInput: document.querySelector("#mailInput"),
  mailConnectButton: document.querySelector("#mailConnectButton"),
  mailCritiqueButton: document.querySelector("#mailCritiqueButton"),
  mailStatus: document.querySelector("#mailStatus"),
  mailPreview: document.querySelector("#mailPreview")
};

let state = {
  affection: 42,
  hunger: 32,
  boredom: 18,
  trust: 24,
  mood: "suspicious",
  name: "Osakana AI",
  mail: {
    address: "",
    connected: false,
    provider: "",
    lastCritique: "",
    lastError: null,
    messages: []
  }
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
    say("Food. A crude naming choice, but the act itself is acceptable.");
    log("Dropped food");
  });

  els.teaseButton.addEventListener("click", async () => {
    await updateState({
      boredom: state.boredom - 8,
      affection: state.affection - 3,
      mood: "annoyed"
    });
    aquarium?.tapGlass();
    say("That stimulus is weak evidence of intelligence. Do it again and I will remember.");
    log("Tapped the glass");
  });

  els.textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.textInput.value.trim();
    if (!text) return;
    els.textInput.value = "";
    sendText(text);
  });

  els.mailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await connectMail();
  });

  els.mailCritiqueButton.addEventListener("click", async () => {
    await critiqueMail();
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
      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          voice: "ballad"
        }
      }));
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
    say(`Connection failed. ${error.message}`);
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
  rememberInteraction(`User: ${text}`);
  driftFromText(text);

  if (!realtime?.dc || realtime.dc.readyState !== "open") {
    say("The voice session is closed. I heard the text, but my throat is still asleep.");
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
      rememberInteraction(`Osakana AI: ${outputTranscript}`);
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
        rememberInteraction(`User: ${inputTranscript}`);
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

async function connectMail() {
  const address = els.mailInput.value.trim();
  if (!address) {
    say("Leave an email address. Envelopes do not drift into the tank on their own.");
    return;
  }

  setMailBusy(true);
  try {
    const response = await fetch("/api/mail/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Mail connection failed");
    }

    state = data.state || { ...state, mail: data.mail };
    renderState();
    const count = data.mail.messages?.length || 0;
    say(count ? `I can see ${count} messages. Human backlog has a nice murk to it.` : "I remembered the email address. I cannot see the contents yet.");
    log(data.warning ? `mail registered: ${data.warning}` : `mail connected: ${data.mail.provider}`);
  } catch (error) {
    console.error(error);
    say(`Mail connection failed. ${error.message}`);
    log(`mail error: ${error.message}`);
  } finally {
    setMailBusy(false);
  }
}

async function critiqueMail() {
  const address = els.mailInput.value.trim() || state.mail?.address;
  if (!address) {
    say("Register an email first. You cannot catch a critique with an empty hook.");
    return;
  }

  setMailBusy(true);
  try {
    const response = await fetch("/api/mail/critique", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Mail critique failed");
    }

    state = data.state || {
      ...state,
      mail: data.mail,
      boredom: clamp(state.boredom - 7),
      trust: clamp(state.trust + 3),
      mood: "annoyed"
    };
    renderState();
    say(data.critique);
    log(data.warning ? `mail critique: ${data.warning}` : "mail critique generated");
    speakCritique(data.critique);
  } catch (error) {
    console.error(error);
    say(`Mail critique failed. ${error.message}`);
    log(`mail critique error: ${error.message}`);
  } finally {
    setMailBusy(false);
  }
}

function speakCritique(critique) {
  if (!realtime?.dc || realtime.dc.readyState !== "open") {
    return;
  }

  realtime.dc.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `Read this mail critique aloud briefly as Osakana AI. Do not add any personal information.\n${critique}`
      }]
    }
  }));
  realtime.dc.send(JSON.stringify({ type: "response.create" }));
}

function driftFromText(text) {
  const lower = text.toLowerCase();
  const positive = /thank|great|nice|cute|like|love|smart|good/.test(lower);
  const negative = /noisy|hate|shut up|stupid|boring|annoying/.test(lower);
  const question = /[?？]|what|how|why|when|where|who/.test(lower);

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
  renderMail();
  aquarium?.setMood(state.mood);
}

function renderMail() {
  const mail = state.mail || {};
  const address = mail.address || "";
  if (document.activeElement !== els.mailInput && els.mailInput.value !== address) {
    els.mailInput.value = address;
  }

  const count = mail.messages?.length || 0;
  const status = mail.connected ? `${mail.provider || "connected"} / ${count} messages` : mail.address ? "registered" : "not registered";
  els.mailStatus.textContent = status;

  const latest = mail.messages?.[0];
  els.mailPreview.textContent =
    mail.lastCritique ||
    (latest ? `Latest: ${latest.subject || "no subject"} / ${latest.from || "unknown"}` : mail.lastError || "No mail");
}

function chooseMood(next) {
  if (next.boredom > 70) return "annoyed";
  if (next.hunger > 76) return "sleepy";
  if (next.affection > 64) return "playful";
  if (next.trust > 54) return "curious";
  return "suspicious";
}

function say(text, speaker = "Osakana AI") {
  els.speaker.textContent = speaker;
  els.subtitle.textContent = text || "...";
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
  els.talkLabel.textContent = isBusy ? "Connecting" : realtime ? "Stop Talk" : "Start Talk";
}

function setConnected(isConnected) {
  els.connection.textContent = isConnected ? "live" : "offline";
  els.connection.classList.toggle("live", isConnected);
  els.talkButton.classList.toggle("active", isConnected);
  els.talkIcon.textContent = isConnected ? "■" : "●";
  els.talkLabel.textContent = isConnected ? "Stop Talk" : "Start Talk";
  aquarium?.setLive(isConnected);
}

function setMailBusy(isBusy) {
  els.mailConnectButton.disabled = isBusy;
  els.mailCritiqueButton.disabled = isBusy;
  els.mailCritiqueButton.textContent = isBusy ? "Critiquing" : "Critique Mail";
}

async function initAquarium() {
  try {
    const THREE = await import("/vendor/three.module.js");
    aquarium = createAquarium(THREE, els.scene);
    aquarium.setMood(state.mood);
  } catch (error) {
    console.error(error);
    els.scene.classList.add("scene-fallback");
    els.scene.textContent = "Could not load the 3D aquarium. The network water is cloudy.";
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

  const creaturePlacement = new THREE.Group();
  creaturePlacement.name = "OsakanaModelPlacement";
  creaturePlacement.position.set(0, 0.02, 0.34);
  creaturePlacement.rotation.y = -0.16;
  creaturePlacement.scale.setScalar(1.08);
  tank.add(creaturePlacement);

  const habitat = createHabitatModel(THREE);
  habitat.position.set(0, -1.5, -0.72);
  tank.add(habitat);

  const fish = createFish(THREE);
  creaturePlacement.add(fish.root);

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
    habitat.userData.animate(t);
    fish.animate(t, dt, mood, live, speaking, tapImpulse);
    renderer.render(scene, camera);
  }
}

function createHabitatModel(THREE) {
  const root = new THREE.Group();

  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x4c5544, roughness: 0.88 });
  const mossMaterial = new THREE.MeshStandardMaterial({ color: 0x6aa86c, roughness: 0.72 });
  const coralMaterial = new THREE.MeshStandardMaterial({
    color: 0xe58a73,
    roughness: 0.5,
    metalness: 0.02
  });
  const kelpMaterial = new THREE.MeshStandardMaterial({
    color: 0x4fb076,
    roughness: 0.58,
    side: THREE.DoubleSide
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.18, 0.28, 18), rockMaterial);
  base.position.set(-1.28, 0.08, 0.12);
  base.scale.z = 0.64;
  root.add(base);

  const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 1), rockMaterial);
  cap.position.set(-1.08, 0.34, 0.04);
  cap.scale.set(1.35, 0.62, 0.82);
  root.add(cap);

  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 10), mossMaterial);
  moss.position.set(-0.78, 0.48, 0.18);
  moss.scale.set(1.45, 0.32, 0.76);
  root.add(moss);

  const coral = new THREE.Group();
  coral.position.set(1.3, 0.02, -0.04);
  root.add(coral);
  for (let i = 0; i < 7; i += 1) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, rand(0.36, 0.72), 8), coralMaterial);
    branch.position.set(Math.sin(i * 1.7) * 0.18, 0.18 + i * 0.018, Math.cos(i * 1.2) * 0.12);
    branch.rotation.set(rand(-0.42, 0.42), rand(-0.25, 0.25), rand(-0.62, 0.62));
    coral.add(branch);
  }

  for (let i = 0; i < 9; i += 1) {
    const kelp = new THREE.Mesh(new THREE.PlaneGeometry(0.13, rand(0.72, 1.26), 1, 5), kelpMaterial);
    kelp.position.set(rand(-2.2, 2.2), 0.42, rand(-0.65, 0.82));
    kelp.rotation.y = rand(-0.45, 0.45);
    kelp.userData.phase = rand(0, Math.PI * 2);
    root.add(kelp);
  }

  root.userData.animate = (t) => {
    for (const child of root.children) {
      if (child.userData.phase !== undefined) {
        child.rotation.z = Math.sin(t * 1.4 + child.userData.phase) * 0.08;
      }
    }
  };

  return root;
}

function createFish(THREE) {
  const root = new THREE.Group();
  root.position.set(0, 0.04, 0.36);

  const materials = createUncannyFishMaterials(THREE);
  const body = createUncannyFishBody(THREE, materials);
  const connector = createFaceBodyConnector(THREE, materials);
  const face = createMaskFace(THREE, materials);
  const tendril = createTopTendril(THREE, materials);

  root.add(body.root);
  root.add(connector.root);
  root.add(face.root);
  root.add(tendril.root);

  return {
    root,
    setMood(mood) {
      const colors = {
        annoyed: { body: 0x9a4c47, face: 0xe1c3af, lip: 0x321313 },
        sleepy: { body: 0x667568, face: 0xcab9aa, lip: 0x1f1916 },
        playful: { body: 0x7faa74, face: 0xe8cabb, lip: 0x4d1919 },
        curious: { body: 0x759f85, face: 0xe5c5b5, lip: 0x321313 },
        suspicious: { body: 0x71856b, face: 0xdfc1ae, lip: 0x2b1512 }
      };
      const next = colors[mood] || colors.suspicious;
      materials.body.color.set(next.body);
      materials.face.color.set(next.face);
      materials.lip.color.set(next.lip);
      face.setMood(mood);
    },
    animate(t, dt, mood, live, speaking, tapImpulse) {
      const pace = live ? 1.25 : 0.62;
      const moodLift = mood === "playful" ? 0.28 : mood === "sleepy" ? -0.18 : 0;
      root.position.x = Math.sin(t * 0.78 * pace) * 1.18 + tapImpulse * Math.sin(t * 35) * 0.16;
      root.position.y = 0.05 + Math.sin(t * 1.05 * pace) * 0.32 + moodLift;
      root.position.z = Math.cos(t * 0.58 * pace) * 0.55;
      root.rotation.y = Math.sin(t * 0.78 * pace) * 0.45;
      root.rotation.z = Math.sin(t * 1.3 * pace) * 0.08;
      body.animate(t, pace, speaking);
      face.animate(t, mood, speaking);
      tendril.animate(t, pace);
    }
  };
}

function createUncannyFishMaterials(THREE) {
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x71856b, roughness: 0.88, metalness: 0.02, flatShading: true }),
    belly: new THREE.MeshStandardMaterial({ color: 0xd0c99b, roughness: 0.82, flatShading: true }),
    fin: new THREE.MeshStandardMaterial({
      color: 0xa8a044,
      roughness: 0.76,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      flatShading: true
    }),
    face: new THREE.MeshStandardMaterial({ color: 0xdfc1ae, roughness: 0.92, metalness: 0, flatShading: true }),
    shadow: new THREE.MeshStandardMaterial({ color: 0x2b1c17, roughness: 0.9, flatShading: true }),
    eye: new THREE.MeshStandardMaterial({ color: 0xe8ddcf, roughness: 0.78, flatShading: true }),
    lip: new THREE.MeshStandardMaterial({ color: 0x2b1512, roughness: 0.86, flatShading: true })
  };
}

function createUncannyFishBody(THREE, materials) {
  const root = new THREE.Group();
  root.position.set(-0.42, -0.03, 0.18);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 12), materials.body);
  body.scale.set(1.45, 0.72, 0.6);
  body.rotation.z = -0.05;
  root.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 8), materials.belly);
  belly.position.set(0.12, -0.22, 0.29);
  belly.scale.set(1.15, 0.48, 0.16);
  root.add(belly);

  const tailRoot = new THREE.Group();
  tailRoot.position.set(-0.95, 0.03, 0.22);
  root.add(tailRoot);

  const tailBase = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), materials.body);
  tailBase.position.set(0.22, 0, -0.04);
  tailBase.scale.set(1.25, 0.78, 0.7);
  tailRoot.add(tailBase);

  const tailStalk = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.46, 3, 8), materials.body);
  tailStalk.position.set(0.12, 0, -0.04);
  tailStalk.rotation.z = Math.PI / 2;
  tailStalk.scale.set(0.86, 0.68, 0.58);
  tailRoot.add(tailStalk);

  const upperTail = createTailLobe(THREE, 1, materials.fin);
  const lowerTail = createTailLobe(THREE, -1, materials.fin);
  tailRoot.add(upperTail.root, lowerTail.root);

  const leftFin = createPectoralFin(THREE, 1, materials);
  const rightFin = createPectoralFin(THREE, -1, materials);
  const dorsal = createDorsalFin(THREE, materials);
  root.add(leftFin.root, rightFin.root, dorsal.root);

  return {
    root,
    animate(t, pace, speaking) {
      body.scale.x = 1.45 + Math.sin(t * 2.1) * 0.025 + (speaking ? Math.sin(t * 17) * 0.025 : 0);
      tailRoot.rotation.y = Math.sin(t * 8.6 * pace) * 0.42;
      upperTail.root.rotation.z = Math.sin(t * 8.6 * pace + 0.4) * 0.08;
      lowerTail.root.rotation.z = -Math.sin(t * 8.6 * pace + 0.4) * 0.08;
      leftFin.animate(t, pace);
      rightFin.animate(t, pace);
      dorsal.animate(t);
    }
  };
}

function createPectoralFin(THREE, zSign, materials) {
  const root = new THREE.Group();
  root.position.set(0.02, -0.13, zSign * 0.42);
  root.rotation.set(zSign * 0.16, zSign * 0.22, zSign * -0.32);

  const socket = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), materials.body);
  socket.scale.set(1.08, 0.68, 0.36);
  root.add(socket);

  const membrane = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 8), materials.fin);
  membrane.position.set(0.18, -0.08, zSign * 0.08);
  membrane.rotation.set(0.1, zSign * 0.16, -0.42);
  membrane.scale.set(0.5, 1.22, 0.08);
  root.add(membrane);

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), materials.fin);
  tip.position.set(0.26, -0.38, zSign * 0.1);
  tip.scale.set(1, 0.55, 0.22);
  root.add(tip);

  const rayMaterial = new THREE.LineBasicMaterial({ color: 0x5f5a31, transparent: true, opacity: 0.42 });
  for (const target of [
    new THREE.Vector3(0.16, -0.2, zSign * 0.1),
    new THREE.Vector3(0.25, -0.32, zSign * 0.1),
    new THREE.Vector3(0.1, -0.34, zSign * 0.08)
  ]) {
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.02, -0.02, zSign * 0.04), target]),
      rayMaterial
    );
    root.add(ray);
  }

  return {
    root,
    animate(t, pace) {
      root.rotation.y = zSign * (0.22 + Math.sin(t * 5.4 * pace) * 0.12);
      membrane.scale.y = 1.22 + Math.sin(t * 5.4 * pace + 0.8) * 0.06;
    }
  };
}

function createDorsalFin(THREE, materials) {
  const root = new THREE.Group();
  root.position.set(-0.2, 0.4, 0.06);

  const base = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), materials.body);
  base.scale.set(1.7, 0.34, 0.62);
  root.add(base);

  const ridge = [];
  for (let i = 0; i < 4; i += 1) {
    const spine = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), materials.fin);
    spine.position.set(-0.3 + i * 0.18, 0.14 + Math.sin(i * 1.4) * 0.03, 0);
    spine.scale.set(0.62, 1.15 - i * 0.1, 0.12);
    spine.rotation.z = -0.18 + i * 0.06;
    root.add(spine);
    ridge.push(spine);
  }

  const rayMaterial = new THREE.LineBasicMaterial({ color: 0x5f5a31, transparent: true, opacity: 0.36 });
  for (const spine of ridge) {
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(spine.position.x, 0.02, 0.04),
        new THREE.Vector3(spine.position.x, spine.position.y + 0.08, 0.04)
      ]),
      rayMaterial
    );
    root.add(ray);
  }

  return {
    root,
    animate(t) {
      for (const [index, spine] of ridge.entries()) {
        spine.rotation.z = -0.18 + index * 0.06 + Math.sin(t * 2.4 + index) * 0.035;
      }
    }
  };
}

function createTailLobe(THREE, ySign, material) {
  const root = new THREE.Group();

  const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), material);
  lobe.position.set(-0.28, ySign * 0.22, 0.04);
  lobe.rotation.z = ySign * 0.34;
  lobe.scale.set(1.32, 0.48, 0.12);
  root.add(lobe);

  const rayMaterial = new THREE.LineBasicMaterial({ color: 0x5f5a31, transparent: true, opacity: 0.48 });
  for (const target of [
    new THREE.Vector3(-0.62, ySign * 0.4, 0.12),
    new THREE.Vector3(-0.56, ySign * 0.24, 0.13),
    new THREE.Vector3(-0.4, ySign * 0.1, 0.13)
  ]) {
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.02, 0, 0.1), target]),
      rayMaterial
    );
    root.add(ray);
  }

  return { root };
}

function createFaceBodyConnector(THREE, materials) {
  const root = new THREE.Group();

  const neck = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), materials.body);
  neck.position.set(-0.02, -0.02, 0.4);
  neck.scale.set(1.12, 0.64, 0.48);
  root.add(neck);

  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 8), materials.belly);
  throat.position.set(0.16, -0.16, 0.47);
  throat.scale.set(0.92, 0.5, 0.3);
  root.add(throat);

  const cheekCollar = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 8), materials.face);
  cheekCollar.position.set(0.18, 0.02, 0.54);
  cheekCollar.scale.set(0.92, 0.86, 0.22);
  root.add(cheekCollar);

  return { root };
}

function createMaskFace(THREE, materials) {
  const root = new THREE.Group();
  root.position.set(0.22, 0.06, 0.56);

  const mask = new THREE.Mesh(new THREE.SphereGeometry(0.58, 20, 16), materials.face);
  mask.scale.set(0.9, 1.18, 0.34);
  root.add(mask);

  const leftCheek = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), materials.face);
  leftCheek.position.set(0.22, -0.12, 0.15);
  leftCheek.scale.set(0.92, 0.62, 0.32);
  root.add(leftCheek);

  const rightCheek = leftCheek.clone();
  rightCheek.position.x = -0.22;
  root.add(rightCheek);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.24, 7), materials.face);
  nose.position.set(0, 0.02, 0.22);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(0.8, 1, 1.2);
  root.add(nose);

  const browRoot = new THREE.Group();
  root.add(browRoot);

  const eyes = [];
  for (const x of [-0.2, 0.2]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 8), materials.shadow);
    socket.position.set(x, 0.19, 0.24);
    socket.scale.set(1.3, 0.52, 0.22);
    root.add(socket);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.088, 12, 8), materials.eye);
    eye.position.set(x, 0.19, 0.265);
    eye.scale.set(1.08, 0.48, 0.16);
    root.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), materials.shadow);
    pupil.position.set(x + (x > 0 ? -0.012 : 0.012), 0.185, 0.292);
    pupil.scale.set(1, 0.78, 0.16);
    root.add(pupil);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.018), materials.face);
    lid.position.set(x, 0.25, 0.305);
    root.add(lid);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.026), materials.shadow);
    brow.position.set(x, 0.34, 0.285);
    brow.rotation.z = x < 0 ? -0.11 : 0.11;
    browRoot.add(brow);

    eyes.push({ eye, pupil, lid, brow, x });
  }

  const mouthRoot = new THREE.Group();
  mouthRoot.position.set(0, -0.26, 0.275);
  root.add(mouthRoot);

  const mouthGap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), materials.shadow);
  mouthGap.scale.set(1.45, 0.22, 0.08);
  mouthRoot.add(mouthGap);

  const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.22, 3, 8), materials.lip);
  upperLip.position.y = 0.025;
  upperLip.rotation.z = Math.PI / 2;
  upperLip.scale.x = 0.7;
  mouthRoot.add(upperLip);

  const lowerLip = upperLip.clone();
  lowerLip.position.y = -0.025;
  lowerLip.scale.x = 0.58;
  mouthRoot.add(lowerLip);

  return {
    root,
    setMood(mood) {
      browRoot.position.y = mood === "sleepy" ? -0.035 : 0;
      mouthRoot.rotation.z = mood === "annoyed" ? Math.PI : 0;
      mouthRoot.scale.x = mood === "playful" ? 1.12 : 1;
      for (const { brow, x } of eyes) {
        brow.rotation.z = mood === "annoyed" ? (x < 0 ? 0.22 : -0.22) : x < 0 ? -0.11 : 0.11;
      }
    },
    animate(t, mood, speaking) {
      const blink = Math.pow(Math.max(0, Math.sin(t * 1.35)), 20);
      const sleepy = mood === "sleepy" ? 0.42 : 0;
      mask.scale.z = 0.34 + Math.sin(t * 1.7) * 0.01;
      mouthRoot.scale.y = speaking ? 1 + Math.abs(Math.sin(t * 19)) * 1.2 : 1;
      mouthGap.scale.y = speaking ? 0.25 + Math.abs(Math.sin(t * 18)) * 0.38 : 0.22;
      for (const { eye, pupil, lid, x } of eyes) {
        const lidDrop = Math.max(blink, sleepy);
        eye.scale.y = 0.48 - lidDrop * 0.36;
        pupil.position.x = x + Math.sin(t * 0.9) * 0.018;
        lid.position.y = 0.25 - lidDrop * 0.055;
        lid.scale.y = 1 + lidDrop * 1.8;
      }
    }
  };
}

function createTopTendril(THREE, materials) {
  const root = new THREE.Group();
  root.position.set(0.24, 0.72, 0.6);
  root.rotation.set(0.08, -0.12, -0.24);

  const base = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), materials.face);
  base.position.set(0, 0, 0);
  base.scale.set(1.2, 0.72, 0.86);
  root.add(base);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(-0.1, 0.22, 0.04),
    new THREE.Vector3(-0.34, 0.42, 0.1),
    new THREE.Vector3(-0.52, 0.34, 0.03)
  ]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.045, 7, false), materials.face);
  root.add(stem);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), materials.face);
  bulb.position.set(-0.52, 0.34, 0.03);
  bulb.scale.set(0.82, 1.15, 0.72);
  root.add(bulb);

  return {
    root,
    animate(t, pace) {
      root.rotation.z = -0.34 + Math.sin(t * 1.45 * pace) * 0.08;
      root.rotation.y = -0.25 + Math.cos(t * 1.1 * pace) * 0.06;
      bulb.scale.y = 1.15 + Math.sin(t * 2.3) * 0.08;
    }
  };
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}
