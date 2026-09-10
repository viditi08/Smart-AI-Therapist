const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib/emma-therapist-profile.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const profile = { exports: {} };
new Function("exports", "module", compiled)(profile.exports, profile);
fs.writeFileSync(
  path.join(root, "voice-backend/emma-prompt.txt"),
  profile.exports.buildTherapistLiveSystemInstruction() + "\n",
);
console.log("Exported Emma's existing system instruction to voice-backend/emma-prompt.txt");
