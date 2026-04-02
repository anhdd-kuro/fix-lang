/// <reference types="electron-vite/node" />
/// <reference types="node" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}
