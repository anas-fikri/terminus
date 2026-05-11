import { Shell } from "./shell/Shell";

const root = document.getElementById("app")!;
const shell = new Shell(root);
shell.mount();
