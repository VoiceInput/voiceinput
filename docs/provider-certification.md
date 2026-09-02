# Provider certification

This record explains the launch defaults with semantic spoken-audio evidence,
not merely a successful connection. Measurements were taken on 2026-09-02 from
the same local machine and network using the checked-in 2.245-second LibriSpeech
fixture, whose reference is `BY HARRY QUILTER M A`. The fixture's license,
attribution, and hash are in
[`fixtures/audio/README.md`](../fixtures/audio/README.md).

Run the checked-in harness after building:

```bash
pnpm test:provider-smoke -- --provider=openai --model=gpt-live-transcribe \
  --language=en-US --vocabulary=Quilter --json
```

It can also vary `--chunk-ms`, `--internal-silence-ms`, `--trailing-silence-ms`,
and `--endpointing` (`false` or a silence duration in milliseconds). Internal
silence is inserted at the fixture's existing word-boundary pause at 1.294
seconds. Timings are local wall-clock observations, not service-level
guarantees. Word error rate (WER) uses strict word-token edit distance, so
ElevenLabs' semantically correct `MA` counts as one word against the reference's
`M A` and produces two token edits.

## OpenAI

All runs streamed 20 ms PCM chunks with `en-US` and `Quilter` vocabulary. An
initial one-run scan produced:

| Model                    |  WER | Connection ms | First interim ms | First final ms | Finalization ms |
| ------------------------ | ---: | ------------: | ---------------: | -------------: | --------------: |
| `gpt-transcribe`         | 0.00 |        1052.2 |           2872.6 |         3079.4 |           591.1 |
| `gpt-live-transcribe`    | 0.00 |        1468.7 |           1536.8 |         3151.1 |           656.4 |
| `gpt-4o-transcribe`      | 0.00 |         516.1 |           2782.5 |         3047.7 |           558.3 |
| `gpt-4o-mini-transcribe` | 0.00 |         468.8 |           2778.3 |         3081.0 |           579.6 |

`gpt-realtime-whisper` could not be certified because the account's live token
endpoint did not issue a credential for it. Three additional comparison runs
showed `gpt-transcribe` first interim at 2787.4–3138.4 ms with WER 0.00 in all
three; `gpt-live-transcribe` produced its first interim at 1531.1–1551.6 ms,
with WER 0.00 in two runs and 0.20 (`Henry` for `Harry`) in one.

The default is therefore `gpt-live-transcribe`: VoiceInput is a live microphone
editing interface, and the model delivered useful partial text about 1.3–1.6
seconds earlier. This agrees with OpenAI's
[Realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription),
which recommends the live model for microphone input. The tradeoff is explicit:
on the test date, the official model pages listed
[`gpt-live-transcribe`](https://developers.openai.com/api/docs/models/gpt-live-transcribe)
at
$0.017 per realtime audio minute and
[`gpt-transcribe`](https://developers.openai.com/api/docs/models/gpt-transcribe)
at $0.0045
per transcription audio minute, about a 3.8× premium. This small sample also
found one live-model recognition error. Consumers can select `gpt-transcribe`
when committed-turn accuracy or cost matters more than interim latency.

The live model accepts `languages` and `keywords`; committed-turn models receive
singular `language` and a vocabulary prompt. Both paths remain covered by unit
tests.

## ElevenLabs

The `scribe_v2_realtime` results were:

| Configuration                                  | Transcript               | Strict WER | First interim ms | First final ms | Finalization ms |
| ---------------------------------------------- | ------------------------ | ---------: | ---------------: | -------------: | --------------: |
| 20 ms chunks, pre-change provider default      | `By Harry Quilter, MA.`  |       0.40 |           2300.7 |         2656.1 |           417.7 |
| 100 ms chunks, pre-change provider default     | `By Harry Quilter, MA.`  |       0.40 |           2111.6 |         2481.8 |           368.4 |
| 20 ms chunks, manual, 1800 ms trailing silence | `By Harry Quilter, MA.`  |       0.40 |           2311.1 |         4580.2 |           374.6 |
| 20 ms chunks, VAD 1500 ms, 1800 ms silence     | `By Harry Quilter, MA.`  |       0.40 |           2432.9 |         4161.6 |           570.2 |
| 20 ms chunks, VAD 650 ms, 1000 ms silence      | `By Harry Quilter, MA.`  |       0.40 |           2403.4 |         3094.1 |           463.8 |
| VAD 650 ms, 700 ms internal + 1000 ms trailing | `By Harry Quilter. M-A.` |       0.00 |             none |         2444.0 |           566.6 |

The adapter keeps direct 20 ms forwarding. Both 20 and 100 ms chunks returned
the same transcript, so coalescing would add buffering state without evidence of
a semantic benefit. This is intentionally narrower than ElevenLabs'
[recommended 100 ms–1 s chunk range](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies),
and should be revisited with a larger noisy-speech corpus if field results show
a problem.

Omitted endpointing now selects VAD with 650 ms of silence. It committed during
the supplied trailing silence and was materially more responsive than the 1500
ms comparison. A second control inserted 700 ms into the fixture's existing 203
ms word-boundary pause: the provider emitted two final parts at the semantic
boundary and their shared accumulation retained the exact five reference words.
`endpointing: false` retains explicit manual commit. The adapter leaves VAD
sensitivity and minimum speech duration at provider defaults: this small clean
corpus is not enough evidence to tune them safely.

## Deepgram

All `nova-3` paths returned the exact reference with 20 ms chunks:

| Language and vocabulary          |  WER | Connection ms | First interim ms | First final ms | Finalization ms | Grant TTL |
| -------------------------------- | ---: | ------------: | ---------------: | -------------: | --------------: | --------: |
| automatic (`multi`), no key term | 0.00 |         401.2 |           1126.1 |         2582.3 |            97.7 |      30 s |
| `en-US`, no key term             | 0.00 |         216.0 |           1114.1 |         2385.8 |            88.4 |      30 s |
| `en-US`, `Quilter` key term      | 0.00 |         212.5 |           1122.2 |         2401.4 |           103.1 |      30 s |

The launch contract remains `nova-3`, automatic `multi` for known multilingual
Nova models, explicit normalized language otherwise, and Nova-3 key terms for
vocabulary. The live grants confirmed the 30-second default TTL. Per Deepgram's
[grant-token reference](https://developers.deepgram.com/reference/auth/tokens/grant),
the grant scope is `usage::write` across core voice APIs rather than narrowly
speech-to-text. The server guide therefore requires a dedicated Member key,
project isolation, spending controls, and separate production/test projects.

## Limits and repeatability

This corpus is deliberately immutable and reproducible, but it is one clean,
short English utterance. It validates option wiring, credential lifetime,
streaming latency, committed finalization, and a basic accuracy regression. It
does not establish broad accent, noise, language, or domain accuracy. Re-run the
harness before changing defaults, and use a larger representative corpus for
product-specific provider selection.
