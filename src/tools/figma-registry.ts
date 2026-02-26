// Import all figma handler maps
import { figmaHandlers as documentHandlers } from "./document";
import { figmaHandlers as selectionHandlers } from "./selection";
import { figmaHandlers as nodeInfoHandlers } from "./node-info";
import { figmaHandlers as createShapeHandlers } from "./create-shape";
import { figmaHandlers as createFrameHandlers } from "./create-frame";
import { figmaHandlers as createTextHandlers } from "./create-text";
import { figmaHandlers as modifyNodeHandlers } from "./modify-node";
import { figmaHandlers as fillStrokeHandlers } from "./fill-stroke";
import { figmaHandlers as layoutHandlers } from "./layout";
import { figmaHandlers as effectsHandlers } from "./effects";
import { figmaHandlers as textHandlers } from "./text";
import { figmaHandlers as fontsHandlers } from "./fonts";
import { figmaHandlers as componentsHandlers } from "./components";
import { figmaHandlers as stylesHandlers } from "./styles";
import { figmaHandlers as variablesHandlers } from "./variables";
import { figmaHandlers as lintHandlers } from "./lint";
import { figmaHandlers as connectionHandlers } from "./connection";

/** Merged dispatch map: command name → handler function */
export const allFigmaHandlers: Record<string, (params: any) => Promise<any>> = {
  ...documentHandlers,
  ...selectionHandlers,
  ...nodeInfoHandlers,
  ...createShapeHandlers,
  ...createFrameHandlers,
  ...createTextHandlers,
  ...modifyNodeHandlers,
  ...fillStrokeHandlers,
  ...layoutHandlers,
  ...effectsHandlers,
  ...textHandlers,
  ...fontsHandlers,
  ...componentsHandlers,
  ...stylesHandlers,
  ...variablesHandlers,
  ...lintHandlers,
  ...connectionHandlers,
};
