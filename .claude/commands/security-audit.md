# Security Audit

Perform a security audit of the Liberty Connect application. Focus on frontend-specific vulnerabilities.

## Audit Checklist

1. **XSS Vulnerabilities**: Find any `v-html` usage with user-supplied content, unsanitized template interpolation, or dynamic attribute injection.

2. **Secrets Exposure**: Check for hardcoded tokens, API keys, passwords, or Directus URLs in source code. Verify `.env` is gitignored and `.env.example` has no real values.

3. **Authentication Issues**: Verify auth tokens are handled by Directus SDK only, no manual localStorage token storage, proper logout clearing all state, route guards on protected pages.

4. **Input Validation**: Check for missing validation at system boundaries, unescaped user inputs, SQL/NoSQL injection vectors via Directus queries.

5. **Dependency Risks**: Check for known vulnerabilities in dependencies, outdated packages with security advisories.

6. **CORS/Network**: Verify HTTPS for all external API calls, no mixed content, proper CORS handling.

## Output Format

Group findings by severity: Critical, High, Medium, Low.

For each finding:
- **File**: path and line number
- **Vulnerability**: description
- **Risk**: what could be exploited
- **Fix**: remediation steps
