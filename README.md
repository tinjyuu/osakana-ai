# お魚AI

Realtime voice creature app inspired by virtual-pet conversation games.

## Run

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY
node server.mjs
```

Open http://localhost:3000.

This first build uses the OpenAI Realtime WebRTC API directly so it can run without npm dependencies in this workspace. The server keeps your API key private and mints short-lived client secrets for the browser.

## MVP

- Realtime microphone conversation with `gpt-realtime`
- Browser WebRTC connection using ephemeral client secrets
- Original aquatic creature character named お魚AI
- Three.js aquarium with glass, water surface, bubbles, gravel, and a swimming fish-like AI creature
- Local creature state persisted to `data/state.json`
- Mood, affection, hunger, boredom, trust, and interaction logs
