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

## Mail

The mail panel stores a registered address in `data/state.json` and can critique recent mail in the fish's voice.

For Gmail, put an OAuth access token with `gmail.readonly` scope in `.env`:

```bash
GMAIL_ACCESS_TOKEN=ya29...
```

For local testing without Gmail, set `MAILBOX_FILE` to a JSON file:

```json
{
  "address": "me@example.com",
  "messages": [
    {
      "from": "sender@example.com",
      "to": "me@example.com",
      "subject": "確認お願いします",
      "date": "2026-04-24",
      "body": "来週の件、ご確認お願いします。"
    }
  ]
}
```

## MVP

- Realtime microphone conversation with `gpt-realtime`
- Browser WebRTC connection using ephemeral client secrets
- Original aquatic creature character named お魚AI
- Three.js aquarium with glass, water surface, bubbles, gravel, and a swimming fish-like AI creature
- Local creature state persisted to `data/state.json`
- Mail registration, recent mail loading, and blunt mail critique
- Mood, affection, hunger, boredom, trust, and interaction logs
