import { generateText } from "ai";
import { gateway } from "./src/api/agent/gateway";
try {
  const r = await generateText({ model: gateway("anthropic/claude-sonnet-4.6"), prompt: "Réponds juste: ok" });
  console.log("GATEWAY OK:", r.text);
} catch (e: any) {
  console.log("GATEWAY KO:", e?.message?.slice(0, 300));
}
