import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

# usage: say.py CHUNKS.json OUT_DIR SPEED VOICE START
# Writes OUT_DIR/<i>.wav for each chunk from START on, in order (each file appears whole).
chunks_path, out_dir, speed, voice, start = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], int(sys.argv[5])
KDIR = os.path.expanduser('~/.local/share/kokoro')
chunks = json.load(open(chunks_path))
k = Kokoro(os.path.join(KDIR, 'kokoro-v1.0.onnx'), os.path.join(KDIR, 'voices-v1.0.bin'))
for i in range(start, len(chunks)):
    samples, sr = k.create(chunks[i], voice=voice, speed=speed, lang='en-us')
    tmp = os.path.join(out_dir, f'{i}.tmp.wav')
    sf.write(tmp, samples, sr)
    os.replace(tmp, os.path.join(out_dir, f'{i}.wav'))
