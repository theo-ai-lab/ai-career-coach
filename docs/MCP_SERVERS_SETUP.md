# MCP Servers Setup Guide

This guide covers all 15 MCP servers configured for the AI Career Coach project. Each server may require API keys or authentication tokens.

## ✅ Installed MCP Servers

All servers are configured in `.cursor/mcp.json`. Update the placeholder values with your actual API keys.

### 1. **PostHog** (Analytics)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Log in to [PostHog](https://posthog.com)
  2. Go to **Settings** → **Personal API Keys**
  3. Create a key with **MCP Server** preset
  4. Replace `YOUR_POSTHOG_PERSONAL_API_KEY_HERE` in `mcp.json`

### 2. **Supabase** (Vector DB & Backend)
- **Status**: ✅ Configured
- **API Keys Required**: Yes (URL + Service Role Key)
- **Setup**:
  1. Go to your [Supabase Dashboard](https://app.supabase.com)
  2. Get your project URL from **Settings** → **API**
  3. Get your **Service Role Key** (⚠️ Keep secret!)
  4. Replace `YOUR_SUPABASE_URL_HERE` and `YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE`
- **Project Relevance**: ⭐ **High** - Used for vector database management

### 3. **Vercel** (Deployment)
- **Status**: ✅ Configured
- **API Token Required**: Yes
- **Setup**:
  1. Go to [Vercel Account Settings](https://vercel.com/account/tokens)
  2. Create a new token
  3. Replace `YOUR_VERCEL_API_TOKEN_HERE`

### 4. **Sentry** (Error Tracking)
- **Status**: ✅ Configured
- **API Keys Required**: Yes (Auth Token + Org)
- **Setup**:
  1. Go to [Sentry Settings](https://sentry.io/settings/account/api/auth-tokens/)
  2. Create an **Auth Token** with `org:read` and `project:read` scopes
  3. Get your organization slug
  4. Replace `YOUR_SENTRY_AUTH_TOKEN_HERE` and `YOUR_SENTRY_ORG_HERE`

### 5. **Linear** (Project Management)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Go to [Linear Settings](https://linear.app/settings/api)
  2. Create a **Personal API Key**
  3. Replace `YOUR_LINEAR_API_KEY_HERE`

### 6. **Braintrust** (AI Evaluation)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Sign up at [Braintrust](https://www.braintrust.dev)
  2. Go to **Settings** → **API Keys**
  3. Create a new API key
  4. Replace `YOUR_BRAINTRUST_API_KEY_HERE`

### 7. **Semgrep** (Code Security)
- **Status**: ✅ Configured
- **App Token Required**: Yes
- **Setup**:
  1. Sign up at [Semgrep](https://semgrep.dev)
  2. Go to **Settings** → **API Tokens**
  3. Create an **App Token**
  4. Replace `YOUR_SEMGREP_APP_TOKEN_HERE`

### 8. **Honeycomb** (Observability)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Sign up at [Honeycomb](https://www.honeycomb.io)
  2. Go to **Settings** → **API Keys**
  3. Create a new API key
  4. Replace `YOUR_HONEYCOMB_API_KEY_HERE`

### 9. **Replicate** (AI Model Hosting)
- **Status**: ✅ Configured
- **API Token Required**: Yes
- **Setup**:
  1. Sign up at [Replicate](https://replicate.com)
  2. Go to **Account** → **API Tokens**
  3. Create a new token
  4. Replace `YOUR_REPLICATE_API_TOKEN_HERE`
- **Project Relevance**: ⭐ **High** - For running AI models

### 10. **Auth0** (Authentication)
- **Status**: ✅ Configured
- **Credentials Required**: Yes (Domain + Client ID + Secret)
- **Setup**:
  1. Go to [Auth0 Dashboard](https://manage.auth0.com)
  2. Get your **Domain** from the dashboard
  3. Go to **Applications** → Create/Select app
  4. Get **Client ID** and **Client Secret**
  5. Replace all three placeholders
- **Project Relevance**: ⭐ **Medium** - For user authentication

### 11. **Notion** (Documentation & Notes)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
  2. Create a new integration
  3. Copy the **Internal Integration Token**
  4. Replace `YOUR_NOTION_API_KEY_HERE`

### 12. **Hugging Face** (AI Models & Datasets)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Sign up at [Hugging Face](https://huggingface.co)
  2. Go to **Settings** → **Access Tokens**
  3. Create a new token with **read** permission
  4. Replace `YOUR_HUGGINGFACE_API_KEY_HERE`
- **Project Relevance**: ⭐ **High** - For AI models and embeddings

### 13. **SonarQube** (Code Quality)
- **Status**: ✅ Configured
- **Credentials Required**: Yes (URL + Token)
- **Setup**:
  1. Set up SonarQube instance (cloud or self-hosted)
  2. Go to **My Account** → **Security** → **Generate Token**
  3. Get your SonarQube server URL
  4. Replace `YOUR_SONARQUBE_URL_HERE` and `YOUR_SONARQUBE_TOKEN_HERE`

### 14. **Playwright** (Browser Automation)
- **Status**: ✅ Configured
- **API Key Required**: No
- **Setup**: No additional setup needed! Playwright will install browsers automatically on first use.

### 15. **Browserbase** (Browser Infrastructure)
- **Status**: ✅ Configured
- **API Key Required**: Yes
- **Setup**:
  1. Sign up at [Browserbase](https://www.browserbase.com)
  2. Go to **Settings** → **API Keys**
  3. Create a new API key
  4. Replace `YOUR_BROWSERBASE_API_KEY_HERE`

## 🔧 Configuration Steps

1. **Open the configuration file**:
   ```bash
   code .cursor/mcp.json
   # or
   open .cursor/mcp.json
   ```

2. **For each server you want to use**:
   - Find the server in the list
   - Replace the placeholder values with your actual API keys/credentials
   - Save the file

3. **Restart Cursor**:
   - Quit Cursor completely (⌘Q on Mac)
   - Reopen Cursor
   - The MCP servers will be available

## ✅ Verification

After restarting Cursor, verify servers are working:

1. Open Cursor Settings → Features → MCP
2. Check that configured servers appear in the list
3. Test by asking the AI assistant:
   - "Show me my Supabase tables" (Supabase)
   - "List my Vercel deployments" (Vercel)
   - "What are my Sentry errors?" (Sentry)
   - etc.

## 🚨 Security Notes

- ⚠️ **Never commit API keys to version control**
- ✅ The `.cursor/` directory is already in `.gitignore`
- ✅ Use environment variables or secure key management for production
- ✅ Rotate API keys regularly
- ✅ Use least-privilege API keys (e.g., PostHog MCP Server preset)

## 📋 Priority Setup for AI Career Coach Project

Based on your project needs, prioritize these servers:

### **Critical** (Set up first):
1. **Supabase** - Vector database for RAG
2. **PostHog** - Analytics (already partially configured)
3. **Hugging Face** - AI models and embeddings

### **High Priority**:
4. **Replicate** - Running AI models
5. **Vercel** - Deployment management

### **Medium Priority**:
6. **Sentry** - Error tracking
7. **Auth0** - If adding user authentication

### **Optional** (Set up as needed):
- Linear, Braintrust, Semgrep, Honeycomb, Notion, SonarQube, Playwright, Browserbase

## 🐛 Troubleshooting

### Server not appearing after restart:
- Check that the JSON syntax is valid
- Verify API keys are correct (no extra spaces)
- Check Cursor's MCP server logs in Settings

### Authentication errors:
- Verify API keys are valid and not expired
- Check key permissions/scopes
- Ensure URLs are correct (no trailing slashes)

### Server fails to start:
- Check that the npm package exists: `npx -y @modelcontextprotocol/server-<name>`
- Some servers may require additional dependencies
- Check Cursor's console for error messages

## 📚 Additional Resources

- [Cursor MCP Documentation](https://docs.cursor.com/context/model-context-protocol)
- [MCP Server Directory](https://cursor.directory)
- [PostHog MCP Docs](https://posthog.com/docs/model-context-protocol)

