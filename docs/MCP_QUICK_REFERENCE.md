# MCP Servers Quick Reference

## ✅ All 15 MCP Servers Configured

All servers are configured in `.cursor/mcp.json`. **Restart Cursor** after adding API keys.

### Server List

| # | Server | API Key Required | Priority for AI Career Coach |
|---|--------|------------------|------------------------------|
| 1 | **PostHog** | ✅ Yes | ⭐ High (Analytics) |
| 2 | **Supabase** | ✅ Yes | ⭐⭐⭐ Critical (Vector DB) |
| 3 | **Vercel** | ✅ Yes | ⭐⭐ High (Deployment) |
| 4 | **Sentry** | ✅ Yes | ⭐ Medium (Error Tracking) |
| 5 | **Linear** | ✅ Yes | ⭐ Low (Project Management) |
| 6 | **Braintrust** | ✅ Yes | ⭐ Low (AI Evaluation) |
| 7 | **Semgrep** | ✅ Yes | ⭐ Low (Code Security) |
| 8 | **Honeycomb** | ✅ Yes | ⭐ Low (Observability) |
| 9 | **Replicate** | ✅ Yes | ⭐⭐ High (AI Models) |
| 10 | **Auth0** | ✅ Yes | ⭐ Medium (Auth) |
| 11 | **Notion** | ✅ Yes | ⭐ Low (Docs) |
| 12 | **Hugging Face** | ✅ Yes | ⭐⭐⭐ Critical (AI Models) |
| 13 | **SonarQube** | ✅ Yes | ⭐ Low (Code Quality) |
| 14 | **Playwright** | ❌ No | ⭐ Low (Testing) |
| 15 | **Browserbase** | ✅ Yes | ⭐ Low (Browser Automation) |

## 🚀 Quick Setup

1. **Edit configuration**: Open `.cursor/mcp.json`
2. **Add API keys**: Replace `YOUR_*_HERE` placeholders
3. **Restart Cursor**: Quit and reopen completely
4. **Verify**: Check Cursor Settings → Features → MCP

## 📝 Next Steps

### For AI Career Coach Project - Set up these first:

1. **Supabase** (Critical)
   - Get URL and Service Role Key from [Supabase Dashboard](https://app.supabase.com)
   - Used for vector database in RAG system

2. **Hugging Face** (Critical)
   - Get API token from [Hugging Face Settings](https://huggingface.co/settings/tokens)
   - Used for embeddings and AI models

3. **PostHog** (High Priority)
   - Already partially configured
   - Get Personal API Key with MCP Server preset

4. **Replicate** (High Priority)
   - Get API token from [Replicate Account](https://replicate.com/account/api-tokens)
   - Used for running AI models

5. **Vercel** (High Priority)
   - Get API token from [Vercel Account](https://vercel.com/account/tokens)
   - Used for deployment management

## 📚 Full Documentation

See `MCP_SERVERS_SETUP.md` for detailed setup instructions for each server.

## 🔒 Security

- ✅ `.cursor/` directory is in `.gitignore`
- ⚠️ Never commit API keys
- ✅ Use least-privilege keys when possible

