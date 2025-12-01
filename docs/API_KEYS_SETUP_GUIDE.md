# API Keys & Tokens Setup Guide

This guide provides step-by-step instructions for obtaining each API key/token required for the MCP servers, with **least-privilege** security recommendations.

## 📋 Complete List of Required Credentials

**Total: 19 placeholders across 15 MCP servers**

---

## 1. PostHog - `YOUR_POSTHOG_PERSONAL_API_KEY_HERE`

### How to Obtain:
1. Log in to [PostHog](https://app.posthog.com)
2. Navigate to **Settings** → **Personal API Keys** (or go to: `https://app.posthog.com/personal-api-keys`)
3. Click **Create Personal API Key**
4. **IMPORTANT**: Select the **"MCP Server" preset** (this limits permissions to only what's needed)
5. Optionally scope to a specific project for better isolation
6. Copy the generated key (starts with `phx_`)

### Least-Privilege:
- ✅ Use **MCP Server preset** (automatically limits permissions)
- ✅ Scope to specific project if possible
- ⚠️ Never use admin-level keys

### Format:
```
Bearer phx_your_key_here
```

---

## 2. Supabase - `YOUR_SUPABASE_URL_HERE` & `YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE`

### How to Obtain:
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project (or create one)
3. Navigate to **Settings** → **API**
4. **URL**: Copy the **Project URL** (e.g., `https://xxxxx.supabase.co`)
5. **Service Role Key**: Copy the **service_role** key (⚠️ **Keep this secret!**)

### Least-Privilege:
- ⚠️ **Service Role Key has admin access** - use only in secure environments
- ✅ Consider using **anon key** for read-only operations if possible
- ✅ Never expose service_role key in client-side code
- ✅ Rotate keys regularly

### Format:
- URL: `https://xxxxx.supabase.co` (no trailing slash)
- Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (long JWT)

---

## 3. Vercel - `YOUR_VERCEL_API_TOKEN_HERE`

### How to Obtain:
1. Go to [Vercel Account Settings](https://vercel.com/account/tokens)
2. Click **Create Token**
3. Name it (e.g., "MCP Server")
4. Set expiration (recommend: 1 year or custom)
5. Copy the token (starts with `vercel_`)

### Least-Privilege:
- ✅ Token has access to all projects by default
- ✅ Consider creating a team token with limited scope if using teams
- ✅ Set expiration date
- ✅ Revoke old tokens when creating new ones

### Format:
```
vercel_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 4. Sentry - `YOUR_SENTRY_AUTH_TOKEN_HERE` & `YOUR_SENTRY_ORG_HERE`

### How to Obtain:
1. Log in to [Sentry](https://sentry.io)
2. Go to **Settings** → **Account** → **Auth Tokens** (or: `https://sentry.io/settings/account/api/auth-tokens/`)
3. Click **Create New Token**
4. **Scopes**: Select:
   - `org:read` (read organization info)
   - `project:read` (read project data)
   - `event:read` (read events/errors)
   - ⚠️ **Do NOT** select `org:write` or `project:write` unless needed
5. Copy the token
6. **Org Slug**: Go to **Settings** → **Organization** → Copy the **Organization Slug**

### Least-Privilege:
- ✅ Use **read-only scopes** (`org:read`, `project:read`, `event:read`)
- ✅ Avoid write permissions unless absolutely necessary
- ✅ Scope to specific projects if possible

### Format:
- Token: `sntrys_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- Org: `your-org-slug` (lowercase, no spaces)

---

## 5. Linear - `YOUR_LINEAR_API_KEY_HERE`

### How to Obtain:
1. Log in to [Linear](https://linear.app)
2. Go to **Settings** → **API** (or: `https://linear.app/settings/api`)
3. Click **Create API Key**
4. Name it (e.g., "MCP Server")
5. Copy the key (starts with `lin_api_`)

### Least-Privilege:
- ✅ API keys have access to all data you can see
- ✅ Use a dedicated service account if possible
- ✅ Revoke unused keys

### Format:
```
lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 6. Braintrust - `YOUR_BRAINTRUST_API_KEY_HERE`

### How to Obtain:
1. Sign up/Log in to [Braintrust](https://www.braintrust.dev)
2. Go to **Settings** → **API Keys** (or navigate to your account settings)
3. Click **Create API Key**
4. Name it (e.g., "MCP Server")
5. Copy the key

### Least-Privilege:
- ✅ API keys typically have full access to your account
- ✅ Use project-specific keys if available
- ✅ Rotate keys periodically

### Format:
```
brat_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 7. Semgrep - `YOUR_SEMGREP_APP_TOKEN_HERE`

### How to Obtain:
1. Sign up/Log in to [Semgrep](https://semgrep.dev)
2. Go to **Settings** → **API Tokens** (or: `https://semgrep.dev/orgs/-/settings/api-tokens`)
3. Click **Create Token**
4. Select **App Token** (not User Token)
5. Name it (e.g., "MCP Server")
6. Copy the token

### Least-Privilege:
- ✅ Use **App Token** (more limited than User Token)
- ✅ App tokens are scoped to specific organizations
- ✅ Revoke when not in use

### Format:
```
semgrep_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 8. Honeycomb - `YOUR_HONEYCOMB_API_KEY_HERE`

### How to Obtain:
1. Sign up/Log in to [Honeycomb](https://www.honeycomb.io)
2. Go to **Settings** → **API Keys** (or: `https://ui.honeycomb.io/settings/api-keys`)
3. Click **Create API Key**
4. Name it (e.g., "MCP Server")
5. **Permissions**: Select **Read** (unless you need write access)
6. Copy the key

### Least-Privilege:
- ✅ Use **Read-only** permissions if possible
- ✅ Scope to specific datasets if available
- ✅ Set expiration date

### Format:
```
hcaik_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 9. Replicate - `YOUR_REPLICATE_API_TOKEN_HERE`

### How to Obtain:
1. Sign up/Log in to [Replicate](https://replicate.com)
2. Go to **Account** → **API Tokens** (or: `https://replicate.com/account/api-tokens`)
3. Click **Create Token**
4. Name it (e.g., "MCP Server")
5. Copy the token (starts with `r8_`)

### Least-Privilege:
- ✅ API tokens have access to your account's models and predictions
- ✅ Monitor usage to prevent unexpected charges
- ✅ Revoke unused tokens

### Format:
```
r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 10. Auth0 - `AUTH0_DOMAIN_HERE`, `AUTH0_CLIENT_ID_HERE`, `AUTH0_CLIENT_SECRET_HERE`

### How to Obtain:
1. Log in to [Auth0 Dashboard](https://manage.auth0.com)
2. **Domain**: Found in the top-left corner (e.g., `your-tenant.auth0.com`)
3. Go to **Applications** → **Applications**
4. Create a new application or select existing:
   - **Name**: "MCP Server" (or similar)
   - **Type**: **Machine to Machine Applications** (recommended) or **Regular Web Application**
5. **Client ID**: Copy from the application settings
6. **Client Secret**: Click **Show** and copy (only shown once - save it!)

### Least-Privilege:
- ✅ Use **Machine to Machine** application type
- ✅ Grant only necessary **APIs** and **scopes**
- ✅ Use **read-only** scopes when possible
- ✅ Rotate client secrets regularly
- ⚠️ Never expose client secret in client-side code

### Format:
- Domain: `your-tenant.auth0.com` (no `https://`)
- Client ID: `xxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- Client Secret: `xxxxxxxxxxxxxxxxxxxxxxxxxxxx` (long string)

---

## 11. Notion - `YOUR_NOTION_API_KEY_HERE`

### How to Obtain:
1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click **+ New integration**
3. Fill in:
   - **Name**: "MCP Server" (or similar)
   - **Type**: **Internal** (for personal use) or **Public** (for workspace)
4. **Capabilities**: Select only what you need:
   - ✅ Read content
   - ✅ Update content (if needed)
   - ⚠️ Insert content (only if needed)
5. Click **Submit**
6. Copy the **Internal Integration Token** (starts with `secret_`)

### Least-Privilege:
- ✅ Use **Internal** integration for personal use
- ✅ Grant access only to specific pages/databases
- ✅ Select minimal capabilities
- ✅ Revoke if compromised

### Format:
```
secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 12. Hugging Face - `YOUR_HUGGINGFACE_API_KEY_HERE`

### How to Obtain:
1. Sign up/Log in to [Hugging Face](https://huggingface.co)
2. Go to **Settings** → **Access Tokens** (or: `https://huggingface.co/settings/tokens`)
3. Click **New token**
4. **Name**: "MCP Server"
5. **Type**: Select **Read** (unless you need write access)
6. Click **Generate token**
7. Copy the token (starts with `hf_`)

### Least-Privilege:
- ✅ Use **Read** token type (can't modify models/datasets)
- ✅ Write tokens only if you need to push models
- ✅ Revoke unused tokens

### Format:
```
hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 13. SonarQube - `YOUR_SONARQUBE_URL_HERE` & `YOUR_SONARQUBE_TOKEN_HERE`

### How to Obtain:
1. **URL**: Your SonarQube instance URL
   - Cloud: `https://sonarcloud.io` (or your organization URL)
   - Self-hosted: `https://your-sonarqube-instance.com`
2. Log in to SonarQube
3. Go to **My Account** → **Security** (or: User menu → **My Account** → **Security**)
4. Under **Generate Tokens**, enter a name (e.g., "MCP Server")
5. Click **Generate**
6. Copy the token (⚠️ Only shown once!)

### Least-Privilege:
- ✅ Tokens inherit your user permissions
- ✅ Use a dedicated service account with minimal permissions
- ✅ Scope to specific projects if possible
- ✅ Set expiration if available

### Format:
- URL: `https://sonarcloud.io` or `https://your-instance.com` (no trailing slash)
- Token: `squ_xxxxxxxxxxxxxxxxxxxxxxxxxxxx` (or similar, format varies)

---

## 14. Playwright - No API Key Required ✅

- **No setup needed!** Playwright installs browsers automatically on first use.

---

## 15. Browserbase - `YOUR_BROWSERBASE_API_KEY_HERE`

### How to Obtain:
1. Sign up/Log in to [Browserbase](https://www.browserbase.com)
2. Go to **Settings** → **API Keys** (or navigate to account settings)
3. Click **Create API Key**
4. Name it (e.g., "MCP Server")
5. Copy the key

### Least-Privilege:
- ✅ API keys typically have access to your account's browser sessions
- ✅ Monitor usage to prevent unexpected charges
- ✅ Revoke unused keys

### Format:
```
bb_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🔒 Security Best Practices

### General:
1. ✅ **Never commit API keys to version control**
   - `.cursor/` is already in `.gitignore`
   - Double-check before committing

2. ✅ **Use least-privilege principles**
   - Read-only tokens when possible
   - Scope to specific projects/resources
   - Use presets (like PostHog MCP Server preset)

3. ✅ **Rotate keys regularly**
   - Set reminders to rotate every 90 days
   - Revoke old keys when creating new ones

4. ✅ **Monitor usage**
   - Check API usage dashboards regularly
   - Set up alerts for unusual activity

5. ✅ **Use environment variables in production**
   - Consider using a secrets manager (AWS Secrets Manager, etc.)
   - Never hardcode in production code

### For This Project:
- **Supabase**: ⚠️ Service Role Key is powerful - keep it secure
- **PostHog**: ✅ Use MCP Server preset (already least-privilege)
- **Auth0**: ✅ Use Machine-to-Machine app with minimal scopes
- **Hugging Face**: ✅ Use Read token (can't modify models)

---

## 📝 Quick Checklist

Before adding keys to `.cursor/mcp.json`:

- [ ] All keys obtained from official sources
- [ ] Read-only permissions where possible
- [ ] Keys copied and stored securely (password manager)
- [ ] Old/unused keys revoked
- [ ] Expiration dates set where available
- [ ] Backup of `.cursor/mcp.json.bak` exists ✅

---

## 🚀 Next Steps

1. **Obtain all keys** using this guide
2. **Open** `.cursor/mcp.json`
3. **Replace** each placeholder with actual values
4. **Save** the file
5. **Restart Cursor** completely
6. **Verify** in Cursor Settings → Features → MCP

---

## 📚 Additional Resources

- [Cursor MCP Documentation](https://docs.cursor.com/context/model-context-protocol)
- [MCP Server Directory](https://cursor.directory)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)

