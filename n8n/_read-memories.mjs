import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

["Memory qualifica","Memory agendador","Memory faq","Memory esp","Memory receptividade"].forEach(name => {
  const n = data.nodes.find(x => x.name === name);
  if (n) {
    console.log(`${name}: sessionKey=${n.parameters?.sessionKey}, contextWindow=${n.parameters?.contextWindowLength}`);
  }
});
