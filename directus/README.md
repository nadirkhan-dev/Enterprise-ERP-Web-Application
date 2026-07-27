# Directus host artifacts

Files here are **not** part of the Nuxt app. They live on the Directus host
(`supplyhubdev`, `10.1.3.81:3027`) and are kept in this repo so they are
reviewable and survive a container being rebuilt from scratch.

## templates/password-reset.liquid

Overrides Directus's stock password-reset email. Directus hands the template only
`url` and `email` — not the user's role or which app they came from — so the
template branches on the reset **link**: a `connect.*` host means the request came
from CONNECT (which sends `reset_url`), anything else is the Directus Studio's own
flow (no `reset_url`, so the link falls back to `PUBLIC_URL/admin/reset-password`).
The Studio branch is the stock copy, verbatim.

Install:

```bash
docker cp directus/templates/password-reset.liquid supplyhubdev:/directus/templates/
docker exec supplyhubdev chmod 644 /directus/templates/password-reset.liquid
```

No restart — Directus re-reads the file from disk on every send.

Rollback:

```bash
docker exec supplyhubdev rm /directus/templates/password-reset.liquid
```

`base.liquid` (the branded shell) does **not** need to be copied: the Liquid engine
root is `[EMAIL_TEMPLATES_PATH, <system templates dir>]`, so `{% layout "base" %}`
resolves the system file.

## Related host config (Directus `.env`, requires a container recreate)

```
PASSWORD_RESET_URL_ALLOW_LIST=https://connect.libertysupply.dev/password-reset
```

Without it, Directus rejects CONNECT's `reset_url` with a 400 and the CONNECT
branch above can never render. The match is exact on origin + pathname — the
trailing slash is significant. This must equal `NUXT_PUBLIC_PASSWORD_RESET_URL`
in the app's environment, character for character.
