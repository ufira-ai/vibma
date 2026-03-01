# Vibma — NPM Setup

> **No cloning, no building.** Install the tunnel and MCP server from npm, grab the plugin from GitHub, and connect.
>
> Prefer full source control? See the [clone-and-build guide](./DRAGME.md).

## Prerequisites

- [Node.js](https://nodejs.org) (v18+)
- [Figma](https://figma.com) desktop or web app
- An AI coding tool with MCP support (Claude Code, Cursor, etc.)

## 1. Download the Figma plugin

Grab the latest **vibma-plugin** from [GitHub Releases](https://github.com/ufira-ai/vibma/releases) — it contains `manifest.json`, `code.js`, and `ui.html`.

Unzip it.

## 2. Start the WebSocket tunnel

```bash
npx @ufira/vibma-tunnel
```

You should see: `WebSocket server running on port 3055`

### About ports

Vibma defaults to port **3055**. The Figma plugin whitelists ports **3055–3058** so you have alternatives if 3055 is already in use. To use a different port:

```bash
VIBMA_PORT=3056 npx @ufira/vibma-tunnel
```

Update the **port field in the Figma plugin UI** before clicking Connect to match.

## 3. Install the Figma plugin

1. In Figma, go to **Plugins > Development > Import plugin from manifest...**
2. Select the `manifest.json` from the unzipped plugin folder
3. Run the plugin — it will show a connection panel

## 4. Configure MCP in your AI tool

Add to your MCP config (e.g. `.cursor/mcp.json`, `.claude.json`, or `.mcp.json`):

```json
{
  "mcpServers": {
    "Vibma": {
      "command": "npx",
      "args": ["-y", "@ufira/vibma"]
    }
  }
}
```

If using a non-default port:

```json
{
  "mcpServers": {
    "Vibma": {
      "command": "npx",
      "args": ["-y", "@ufira/vibma", "--port=3056"]
    }
  }
}
```

## 5. Connect

1. In the Figma plugin, set the channel name to `vibma` (or any name you like)
2. Click **Connect**
3. In your AI tool, call `join_channel` with the same channel name (defaults to `vibma`)
4. Call `ping` — you should get back `pong` with your document name

## Troubleshooting

**Plugin won't connect to WebSocket**: Make sure the tunnel is running. The plugin connects to `ws://localhost:3055` by default.

**MCP shows disconnected**: Restart your AI tool after changing MCP config. Stdio-based MCP servers can't hot-reload.

**Port already in use**: Kill the existing process (`lsof -ti:3055 | xargs kill`) or use the next available port (3056–3058).

---

## Instructions for AI Agents

The section below is for AI agents setting up Vibma on behalf of a user. Follow these steps in order.

### Plugin download

Download the latest **vibma-plugin** zip from [GitHub Releases](https://github.com/ufira-ai/vibma/releases) and unzip it. After unzipping, tell the user the full path to the `manifest.json` so they can easily find it when importing the plugin in Figma.

### Port resolution

Before starting the tunnel, check if the default port is available:

```bash
lsof -ti:3055
```

If the port is occupied, ask the user:

> Port 3055 is already in use by another process (PID: <pid>). Would you like to:
> 1. **Kill the process** on port 3055 and use it for Vibma
> 2. **Use the next available port** (3056, 3057, or 3058)

If the user chooses option 2, scan ports in order:

```bash
lsof -ti:3056 || echo "3056 is free"
lsof -ti:3057 || echo "3057 is free"
lsof -ti:3058 || echo "3058 is free"
```

Use the first free port. Set `VIBMA_PORT=<port>` when starting the tunnel, and pass `--port=<port>` to the MCP server in the MCP config. Inform the user to set the same port in the Figma plugin UI before clicking Connect.

If all four ports (3055–3058) are occupied, tell the user they need to free one.

### Connection verification

After the user opens the Figma plugin, it should automatically show **Connected** on the default port (3055). If a non-default port was used, the user will need to select the correct port in the plugin UI and click Connect.

1. Call `join_channel` (defaults to channel `vibma` — use a different name only if the user specifies one).
2. Call `ping`. Expected response: `{ status: "pong", documentName: "...", currentPage: "...", timestamp: ... }`

If `ping` returns a `pong` with a document name, the full chain is verified. Proceed with design tasks.

### Troubleshooting connection issues

If the plugin shows **Disconnected** on port 3055, try the following before asking the user:

1. Check the tunnel is running: `lsof -ti:3055` — if no output, the tunnel isn't started.
2. Restart the tunnel: `npx @ufira/vibma-tunnel`
3. Ask the user to close and reopen the Figma plugin.

If the issue persists after these steps, direct the user to the [Vibma Discord](https://discord.gg/4XTedZdwV6) for help.

If any tool times out after a successful `join_channel`, the Figma plugin is not connected to the tunnel. The timeout error will include the port and channel the MCP server is using. Ask the user to check the Figma plugin window and confirm:
- The **port** matches what MCP is using
- The **channel name** matches what MCP joined
- The plugin status shows **Connected**

### Version mismatch

If `join_channel` returns a version mismatch warning, the Figma plugin and MCP server are running different versions. Offer to help the user update:

- **MCP server**: Update the MCP config args to use `@latest` (e.g. `"args": ["-y", "@ufira/vibma@latest"]`), or clear the npx cache with `npx clear-npx-cache` then re-run.
- **Figma plugin**: Download the latest `vibma-plugin.zip` from [GitHub Releases](https://github.com/ufira-ai/vibma/releases), unzip, and re-import the `manifest.json` in Figma.

The tunnel relay rarely needs updating — it is a simple message router and stays backward compatible.
