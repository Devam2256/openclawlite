#!/usr/bin/env bun 

import { config } from "dotenv";
import { join } from "path";
config({ path: join(import.meta.dir, ".env") });

import { Command } from "commander";
import { runWakeup } from "./tui/wakeup";

const program = new Command();

program
    .name("openclawlite")
    .description("openclaw lite version")
    .version("0.0.1");

program
    .command("wakeup")
    .description("Show the banner and pick cli or telegram mode")
    .action(
        async() => {
            await runWakeup();
        }
    );

await program.parseAsync(process.argv);
