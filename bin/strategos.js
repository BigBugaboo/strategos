#!/usr/bin/env node

import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(`strategos: ${error.message}`);
  if (process.env.STRATEGOS_DEBUG === "1") {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
