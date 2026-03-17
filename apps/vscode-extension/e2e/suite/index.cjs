const path = require("path");
const Mocha = require("mocha");
const { glob } = require("glob");

async function run() {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 120000
  });

  const files = await glob("**/*.e2e.cjs", {
    cwd: __dirname
  });

  for (const file of files) {
    mocha.addFile(path.resolve(__dirname, file));
  }

  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension E2E test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { run };
