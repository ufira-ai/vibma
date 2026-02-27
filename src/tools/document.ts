import { z } from "zod";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "get_document_info",
    "Get the document name, current page, and list of all pages.",
    {},
    async () => {
      try { return mcpJson(await sendCommand("get_document_info")); }
      catch (e) { return mcpError("Error getting document info", e); }
    }
  );

  server.tool(
    "get_current_page",
    "Get the current page info and its top-level children. Always safe — never touches unloaded pages.",
    {},
    async () => {
      try { return mcpJson(await sendCommand("get_current_page")); }
      catch (e) { return mcpError("Error getting current page", e); }
    }
  );

  server.tool(
    "get_pages",
    "Get all pages in the document with their IDs, names, and child counts.",
    {},
    async () => {
      try { return mcpJson(await sendCommand("get_pages")); }
      catch (e) { return mcpError("Error getting pages", e); }
    }
  );

  server.tool(
    "set_current_page",
    "Switch to a different page. Provide either pageId or pageName.",
    {
      pageId: z.string().optional().describe("The page ID to switch to"),
      pageName: z.string().optional().describe("The page name (case-insensitive, partial match)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("set_current_page", params)); }
      catch (e) { return mcpError("Error setting current page", e); }
    }
  );

  server.tool(
    "create_page",
    "Create a new page in the document",
    { name: z.string().optional().describe("Name for the new page (default: 'New Page')") },
    async ({ name }: any) => {
      try { return mcpJson(await sendCommand("create_page", { name })); }
      catch (e) { return mcpError("Error creating page", e); }
    }
  );

  server.tool(
    "rename_page",
    "Rename a page. Defaults to current page if no pageId given.",
    {
      newName: z.string().describe("New name for the page"),
      pageId: z.string().optional().describe("Page ID (default: current page)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("rename_page", params)); }
      catch (e) { return mcpError("Error renaming page", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

async function getDocumentInfo() {
  return {
    name: figma.root.name,
    currentPageId: figma.currentPage.id,
    pages: figma.root.children.map((p: any) => (
      { id: p.id, name: p.name }
    )),
  };
}

async function getCurrentPage() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    id: page.id,
    name: page.name,
    children: page.children.map((node: any) => ({ id: node.id, name: node.name, type: node.type })),
  };
}

async function getPages() {
  return {
    currentPageId: figma.currentPage.id,
    pages: figma.root.children.map((p: any) => (
      { id: p.id, name: p.name }
    )),
  };
}

async function setCurrentPage(params: any) {
  let page: any;
  if (params.pageId) {
    page = await figma.getNodeByIdAsync(params.pageId);
    if (!page || page.type !== "PAGE") throw new Error(`Page not found: ${params.pageId}`);
  } else if (params.pageName) {
    const name = params.pageName.toLowerCase();
    page = figma.root.children.find((p: any) => p.name.toLowerCase() === name);
    if (!page) page = figma.root.children.find((p: any) => p.name.toLowerCase().includes(name));
    if (!page) {
      const available = figma.root.children.map((p: any) => p.name);
      throw new Error(`Page not found: '${params.pageName}'. Available pages: [${available.join(", ")}]`);
    }
  }
  await figma.setCurrentPageAsync(page);
  return { id: page.id, name: page.name };
}

async function createPage(params: any) {
  const name = params?.name || "New Page";
  const page = figma.createPage();
  page.name = name;
  return { id: page.id };
}

async function renamePage(params: any) {
  if (!params?.newName) throw new Error("Missing newName parameter");
  let page: any;
  if (params.pageId) {
    page = await figma.getNodeByIdAsync(params.pageId);
    if (!page || page.type !== "PAGE") throw new Error(`Page not found: ${params.pageId}`);
  } else {
    page = figma.currentPage;
  }
  page.name = params.newName;
  return "ok";
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  get_document_info: getDocumentInfo,
  get_current_page: getCurrentPage,
  get_pages: getPages,
  set_current_page: setCurrentPage,
  create_page: createPage,
  rename_page: renamePage,
};
