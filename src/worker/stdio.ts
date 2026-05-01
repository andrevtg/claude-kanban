// NDJSON stdio helpers for the worker subprocess.
//
// Worker → parent: serialize a WireMessage with encodeWireMessage and write
// one line to stdout. Parent → worker: stdin yields newline-delimited JSON;
// readWireMessages parses each line and surfaces ParseErrors as Result values
// (never throws — see the wire-protocol skill, rule 3).
//
// Stdin EOF terminates the generator; the caller treats that as an implicit
// cancel signal. See task-04.

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  encodeWireMessage,
  parseWireMessage,
  type ParseError,
  type Result,
  type WireMessage,
} from "../protocol/messages.js";

export type SendFn = (msg: WireMessage) => void;

export function makeSender(output: Writable = process.stdout): SendFn {
  return (msg: WireMessage) => {
    output.write(`${encodeWireMessage(msg)}\n`);
  };
}

export async function* readWireMessages(
  input: Readable = process.stdin,
): AsyncGenerator<Result<WireMessage, ParseError>, void, void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    yield parseWireMessage(line);
  }
}
