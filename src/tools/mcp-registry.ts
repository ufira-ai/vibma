import type { McpServer, SendCommandFn } from "./types";

// Import all tool modules
import { registerMcpTools as registerDocument } from "./document";
import { registerMcpTools as registerSelection } from "./selection";
import { registerMcpTools as registerNodeInfo } from "./node-info";
import { registerMcpTools as registerCreateShape } from "./create-shape";
import { registerMcpTools as registerCreateFrame } from "./create-frame";
import { registerMcpTools as registerCreateText } from "./create-text";
import { registerMcpTools as registerModifyNode } from "./modify-node";
import { registerMcpTools as registerFillStroke } from "./fill-stroke";
import { registerMcpTools as registerLayout } from "./layout";
import { registerMcpTools as registerEffects } from "./effects";
import { registerMcpTools as registerText } from "./text";
import { registerMcpTools as registerFonts } from "./fonts";
import { registerMcpTools as registerComponents } from "./components";
import { registerMcpTools as registerStyles } from "./styles";
import { registerMcpTools as registerVariables } from "./variables";
import { registerMcpTools as registerLint } from "./lint";
import { registerMcpTools as registerConnection } from "./connection";
import { registerPrompts } from "./prompts";

/** Register all MCP tools and prompts on the server */
export function registerAllTools(server: McpServer, sendCommand: SendCommandFn) {
  registerDocument(server, sendCommand);
  registerSelection(server, sendCommand);
  registerNodeInfo(server, sendCommand);
  registerCreateShape(server, sendCommand);
  registerCreateFrame(server, sendCommand);
  registerCreateText(server, sendCommand);
  registerModifyNode(server, sendCommand);
  registerFillStroke(server, sendCommand);
  registerLayout(server, sendCommand);
  registerEffects(server, sendCommand);
  registerText(server, sendCommand);
  registerFonts(server, sendCommand);
  registerComponents(server, sendCommand);
  registerStyles(server, sendCommand);
  registerVariables(server, sendCommand);
  registerLint(server, sendCommand);
  registerConnection(server, sendCommand);
  registerPrompts(server);
}
