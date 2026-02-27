import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'your-key-here') {
      throw new Error(
        'ANTHROPIC_API_KEY not set. Add your key to backend/.env'
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}
