# talk

Easier replies for a busy brain: the mod reads Claude's whole reply out loud, in a natural voice. A band above the prompt has Pause/Resume, Replay and a speed bar (0.5x to 3x). Code blocks, links and markdown marks are skipped, not read.

## Install

```
claude plugin marketplace add DevMits/claude-talk
claude plugin install talk@claude-talk
```

To try it for one session: `claude --plugin-dir ~/claude-talk` (add `-r` to resume an old conversation).

## Voice setup (Kokoro, Linux)

Kokoro needs Python 3.12, so it gets its own private environment. `uv` makes it:

```
mise x uv@latest -- uv venv --python 3.12 ~/.local/share/kokoro/.venv
mise x uv@latest -- uv pip install --python ~/.local/share/kokoro/.venv/bin/python kokoro-onnx soundfile
cd ~/.local/share/kokoro
B=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
curl -LO $B/kokoro-v1.0.onnx && curl -LO $B/voices-v1.0.bin
cp <this folder>/kokoro/say.py ~/.local/share/kokoro/say.py
```

The mod prepares the next sentences while one plays. If Kokoro fails, it falls back to `espeak-ng` (robotic). Change the voice with `VOICE` at the top of `hooks/register.tsx` (default `af_heart`).

## Use

- `/talk` shows whether reading aloud is on.
- `/talk off` stops reading and silences future replies. `/talk on` turns it back on.

The setting is saved, so it carries across sessions.
