---
"@voiceinput/openai": patch
---

Always flush trailing audio when stopping, even while a voice activity detection
commit is pending. Keep those acknowledgements separate so the earlier turn
cannot close the stream before the remaining speech is transcribed.
