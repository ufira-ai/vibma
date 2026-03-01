# Changelog

## v0.2.0

> **Breaking:** The relay now requires a `role` field on join and uses role-targeted routing instead of broadcast. **All three components (plugin, relay, MCP server) must be upgraded together.** Old clients (v0.1.1) will be rejected by the new relay with `INVALID_ROLE`.

### Tunnel Stability & User Experience

Hardened the relay connection layer and polished the plugin UI so agents can self-diagnose connectivity issues without human intervention.

- **`reset_tunnel`** — factory-reset stuck channels via HTTP, replacing `reset_socket`
- **Channel enforcement** — one plugin + one MCP per channel, with version mismatch warnings surfaced to both plugin UI and agent with update instructions
- **Same-client rejoin** — calling `join_channel` when already connected returns success instead of `ROLE_OCCUPIED`
- **Meaningful plugin errors** — "Relay not reachable on port X" instead of generic "Connection error"
- **Write-access warning** in plugin UI when editing is restricted
- **Agentic troubleshooting** — connection troubleshooting docs and absolute paths in MCP config examples so agents can guide users through setup issues

### WCAG 2.2 Accessibility

Added accessibility linting to help designers build with WCAG compliance in mind.

- **`lint_node` WCAG rules** — contrast ratio (AA/AAA), non-text contrast, target size, text size, and line-height checks
- **Inline WCAG warnings** on `update_text_style` when values fall below recommended minimums

### Component Quality

Agents can now create richer component instances using text properties in addition to variants — modifying instances through properties instead of deep-diving into child nodes, saving context and tool call round trips.

- **`set_instance_properties`** — set text overrides, booleans, and instance swaps on component instances
- **`no-text-property` lint rule** — flag components missing exposed text properties
- **Prefixed variant key handling** — `create_instance_from_local` correctly resolves variant properties with internal prefixes

### Performance

- Preload fonts in parallel for text style batches
- Async `getMainComponentAsync` + node budget cap for `serializeNode`
- Unified tool responses via shared `batchHandler`, reducing overhead

### Other

- **`update_paint_style` / `update_text_style`** — update existing styles by ID or name
- **`set_variable_value`** accepts hex strings (`"#RRGGBB"`) for COLOR variables, consistent with all other color tools
- Dockerfile updated for Node.js tunnel

## v0.1.1

- Replace Bun socket server with Node.js + `ws`
- Extract relay to standalone `@ufira/vibma-tunnel` package
- Updated setup guides for Node.js + npm workflow

## v0.1.0

- Initial release
