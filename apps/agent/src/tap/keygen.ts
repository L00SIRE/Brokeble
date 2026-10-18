// Run once: `pnpm --filter @tab/agent exec tsx src/tap/keygen.ts`. Prints secrets to stdout; store them in the password
// manager and Fly/Vercel env, never in git. TAP_KEY_DIRECTORY_JSON is public-key data for the venue.
import { createPublicKey, generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const kid = process.env.TAP_KEY_ID ?? "tab-agent-ed25519-1";
console.log(`TAP_KEY_ID=${kid}`);
console.log("TAP_PRIVATE_KEY_PEM_B64=" + Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64"));
console.log("TAP_KEY_DIRECTORY_JSON=" + JSON.stringify({ [kid]: createPublicKey(privateKey).export({ format: "jwk" }) }));
