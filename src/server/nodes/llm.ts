/**
 * Node-RED node: llm
 *
 * Inline LLM step inside a flow. Sends a single prompt to Claude and
 * forwards the response text. Designed so flows can include AI-driven
 * branching, summarisation, or text generation as just another node.
 *
 * Config:
 *   apiKey   Anthropic API key (or set ANTHROPIC_API_KEY in the environment)
 *   model    model alias (default: claude-haiku-4-5)
 *   system   optional system prompt prepended to every call
 *   maxTokens optional cap on response length (default 1024)
 *
 * Input msg:
 *   msg.prompt   user message text — required
 *   msg.system   override default system prompt
 *
 * Output msg:
 *   msg.payload  text content of the model response
 *   msg.usage    { input_tokens, output_tokens }
 *
 * Demo-grade. No prompt caching, no streaming, no tool use, no images.
 * Each call opens a fresh HTTP connection; production should reuse a
 * single Anthropic client instance (this node already does — it's
 * cached for the lifetime of the deployed node).
 */
import Anthropic from '@anthropic-ai/sdk';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'llm';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 1024;

const llmNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const apiKey = cfgString(config, 'apiKey') ?? process.env['ANTHROPIC_API_KEY'];
    const model = cfgString(config, 'model') ?? DEFAULT_MODEL;
    const defaultSystem = cfgString(config, 'system');
    const maxTokens = cfgNumber(config, 'maxTokens') ?? DEFAULT_MAX_TOKENS;

    makeConnectorNode<Anthropic>(RED, config, {
      init: async () => {
        if (apiKey === undefined) {
          throw new Error('llm: apiKey is required (config field or ANTHROPIC_API_KEY env)');
        }
        return new Anthropic({ apiKey });
      },
      handle: async (client, msg: NodeMessage) => {
        const prompt = typeof msg['prompt'] === 'string' ? (msg['prompt'] as string) : undefined;
        if (prompt === undefined || prompt.trim() === '') {
          throw new Error('llm: msg.prompt is required (non-empty string)');
        }
        const system =
          typeof msg['system'] === 'string' ? (msg['system'] as string) : defaultSystem;
        const resp = await client.messages.create({
          model,
          max_tokens: maxTokens,
          ...(system !== undefined ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        });
        // Concatenate every text block in the response. Tool-use blocks
        // are ignored at this layer; if a flow needs them, the LLM node
        // can be extended later.
        // The SDK's ContentBlock union widens over time (text, tool_use,
        // thinking, …). Pull out the text we care about without locking
        // to a specific block shape by checking `type` then `text`.
        const text = resp.content
          .map((block) => {
            if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string') {
              return block.text;
            }
            return '';
          })
          .filter((s) => s !== '')
          .join('\n');
        return { text, usage: resp.usage };
      },
      // No dispose — the Anthropic client is stateless w.r.t. background
      // resources (it just owns an HTTP agent that GCs naturally).
      dispose: async () => {},
    })(this);
  });
};

export default llmNode;
