# Security Rules

## Secrets Management
- No secrets in source code — use `.env` + `runtimeConfig`
- `.env` is gitignored; `.env.example` provides templates
- MCP server configs use `${VAR}` syntax to reference env variables

## XSS Prevention
- Never use `v-html` with user-supplied content
- Rely on Vue's default template escaping
- Sanitize any content that must render as HTML

## Authentication
- Auth tokens handled exclusively by Directus SDK
- Never store tokens in localStorage manually
- Use navigation guards for protected routes
- Implement proper logout (clear all auth state)

## General
- Validate user input at system boundaries
- Use HTTPS for all external API calls
- Never log sensitive data (tokens, passwords, PII)
- Keep dependencies updated — review security advisories
