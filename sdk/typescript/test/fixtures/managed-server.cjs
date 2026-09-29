const fs = require("node:fs");
const mode = process.argv[2];
console.log(`spawned:${process.pid}`);
if (mode === "fail") {
  process.exit(23);
}
if (mode === "ready") {
  fs.writeFileSync("secret-key.bin", Buffer.alloc(32, 1));
  console.log("Finished loading!");
}
setInterval(() => {}, 1000);
