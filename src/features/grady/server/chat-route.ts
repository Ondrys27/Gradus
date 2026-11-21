import "server-only";
import {
  parseRouteAnswer,
  ROUTE_INSTRUCTIONS,
  routeByRules,
  routeQuestion,
  type ChatRouteInput,
} from "../chat-route";
import type { AutoPick } from "../model-settings";
import { streamModel, type ModelCall } from "./model";

/**
 * The chat's automatic choice for one message: the rules, and only when they
 * cannot tell, one Haiku call answering one word (feature chat_route, at most
 * ROUTE_MAX_TOKENS out). The call goes through streamModel like any other:
 * the budget checks it and ai_usage records it, so the administration sets
 * its cost against what the choice saved. A failed call picks Sonnet.
 */
export async function pickChatModel(
  input: ChatRouteInput,
  call: Pick<ModelCall, "client" | "userId" | "log">,
): Promise<AutoPick> {
  const byRules = routeByRules(input);
  if (byRules) return byRules;
  const result = await streamModel({
    client: call.client,
    userId: call.userId,
    feature: "chat_route",
    instructions: ROUTE_INSTRUCTIONS,
    context: "",
    messages: [{ role: "user", content: routeQuestion(input.message) }],
    log: call.log,
  });
  return result.ok ? parseRouteAnswer(result.text) : "sonnet";
}
