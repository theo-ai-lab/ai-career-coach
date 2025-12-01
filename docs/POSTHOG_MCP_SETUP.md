# PostHog MCP Setup Guide

This guide will help you set up PostHog as a permanent MCP (Model Context Protocol) server in Cursor.

## Prerequisites

1. A PostHog account (sign up at https://posthog.com if you don't have one)
2. A PostHog Personal API Key with MCP Server preset

## Step 1: Get Your PostHog Personal API Key

1. Log in to your PostHog account
2. Go to **Settings** → **Personal API Keys**
3. Click **Create Personal API Key**
4. Select the **MCP Server** preset (this limits access to necessary resources)
5. Optionally, scope it to a specific project for data isolation
6. Copy the generated API key

## Step 2: Configure the MCP Server

1. Open `.cursor/mcp.json` in this project
2. Replace `YOUR_POSTHOG_PERSONAL_API_KEY_HERE` with your actual API key:
   ```json
   "POSTHOG_AUTH_HEADER": "Bearer YOUR_ACTUAL_API_KEY"
   ```

## Step 3: Restart Cursor

After updating the configuration:
1. Save the `mcp.json` file
2. Restart Cursor completely (quit and reopen)
3. The PostHog MCP server should now be available

## Step 4: Verify the Integration

Once Cursor restarts, you can verify the integration by asking the AI assistant:
- "Show me my most common errors in PostHog"
- "Create a funnel for the checkout flow"
- "What are the top events in my PostHog project?"

## Alternative: Using PostHog Wizard

You can also use the PostHog Wizard to set this up automatically:

```bash
npx @posthog/wizard mcp add
```

This will guide you through the setup process interactively.

## Security Notes

- Never commit your API key to version control
- The `.cursor/mcp.json` file should be in your `.gitignore`
- Use the MCP Server preset when creating your API key to limit permissions
- Consider scoping the API key to a specific project for better data isolation

## Troubleshooting

If the MCP server doesn't work:
1. Check that your API key is correct and has the MCP Server preset
2. Verify the `mcp.json` file is in the correct location (`.cursor/mcp.json`)
3. Make sure you've restarted Cursor after making changes
4. Check Cursor's MCP server status in settings

