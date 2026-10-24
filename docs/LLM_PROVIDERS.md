# Who writes the notes

The words of a recording are turned into notes by a language model. **Three** can do
it, and which one is used is decided by what is set up. This is how each one is
chosen, what it needs, and what it costs.

| Provider | Where the words go | Needs | Good for |
|---|---|---|---|
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY` | The best notes. |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` | Claude, or another model, without an Anthropic workspace. |
| `ollama` | **Nowhere** — this computer | Ollama running | Nothing leaving the machine. |

## Choosing one

`LLM_PROVIDER` pins it: `anthropic`, `openrouter` or `ollama`.

Without it, the provider is chosen by what is actually set up:

1. `anthropic` if `ANTHROPIC_WORKSPACE_ID` is set.
2. `openrouter` if `OPENROUTER_API_KEY` is set.
3. `anthropic` if `ANTHROPIC_API_KEY` is set.
4. `ollama` otherwise.

## Anthropic, and the workspace

A Claude API key usually belongs to a **workspace**. Such a key cannot be used on
its own: every request has to say which workspace it is for.

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_WORKSPACE_ID=...
```

Without the second line the API says so itself:

> This API key is not scoped to a workspace, so this request must include the
> anthropic-workspace-id header with the ID of the workspace to use.

The workspace ID is in the Anthropic console, under Settings → Workspaces. It cannot
be looked up with the key alone: listing the workspaces needs a permission the key
does not have.

**If a key belongs to a workspace, `ANTHROPIC_WORKSPACE_ID` must be set.** Without it
the notes fail, and the recording is marked failed with the API's own words.

## OpenRouter

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
```

Any model on OpenRouter can be used. The model name is the one OpenRouter uses, with
the provider before the slash, as in `openai/gpt-4o-mini`.

## Ollama, on this computer

```
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2:3b-instruct-q4_K_M
```

`OLLAMA_BASE_URL` has to be `host.docker.internal` when the Edge Functions run in
Docker, because from inside a container `localhost` is the container itself. The
address works because Docker Desktop points it at this computer. A hosted setup uses
`http://localhost:11434` instead.

Ollama has to be **listening on more than the loopback** for a container to reach
it. If it is not, the notes fail with a connection error.

Ollama is given the notes schema itself, so the answer comes back already shaped and
does not need picking apart.

### Which model

| Model | Time for the notes | Notes quality |
|---|---|---|
| `llama3.2:3b-instruct-q4_K_M` | about 110 s | Usable. The shape is always right; the wording can be thin. |
| `qwen2.5:7b-instruct-q4_K_M` | over 5 min | Better, but too slow on a processor. |
| `gemma2:2b-instruct-q4_K_M` | about 95 s | Usable. |

Those times are from **this** computer, running on the processor with no graphics
card. A machine with a graphics card is far quicker. The default is the 3B model, so
the notes arrive in a reasonable time.

`LLM_TIMEOUT_MS` sets how long to wait before giving up. It is 300,000 — five
minutes — by default.

## Trying it

The whole pipeline can be run against a local stack, from a new account through the
audio, the transcription and the notes:

```powershell
node scripts\test-local-pipeline.cjs
```

It prints the transcript and the notes, and says which provider wrote them.

After changing `.env.local`, the Edge Runtime has to be rebuilt, because the
Supabase CLI only reads the env file when it creates the container:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restart-local-functions.ps1
```

## A note on the speech service

The speech service is normally given a link to the audio, which is the quick way. A
local setup keeps the audio on one computer, and the service cannot open a link to
it. When that happens the audio is sent directly instead, so a local setup works the
same way a hosted one does.

This does not change what happens on a hosted setup: the link is still tried first,
and only if the service says it cannot reach the audio is the audio itself sent.
