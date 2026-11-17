import { describe, expect, it } from 'vitest';
import { openaiModel } from './openai.js';
import type { ModelMessage, ModelTool } from './models.js';

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A fetch that records the request and answers with the given chat completion. */
function fakeFetch(reply: unknown, sent: Sent[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const tools: ModelTool[] = [
  {
    name: 'school_attendance_today',
    description: 'Registers marked today',
    input_schema: { type: 'object', properties: { institutionId: { type: 'string' } } },
  },
];

describe('openaiModel', () => {
  it('sends the system prompt, tools and earlier tool calls in OpenAI chat form', async () => {
    const sent: Sent[] = [];
    const model = openaiModel({
      apiKey: 'sk-test-0000000000000000',
      model: 'test-model',
      fetch: fakeFetch(
        {
          choices: [
            { finish_reason: 'stop', message: { role: 'assistant', content: '3 of 4 marked.' } },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 8 },
        },
        sent,
      ),
    });
    const messages: ModelMessage[] = [
      { role: 'user', content: 'How many registers are marked?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'school_attendance_today',
            input: { institutionId: 'x' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"marked":3,"of":4}' }],
      },
    ];
    const turn = await model.respond({ system: 'Be brief.', tools, messages });

    expect(sent[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0]?.headers.authorization).toBe('Bearer sk-test-0000000000000000');
    expect(sent[0]?.body).toMatchObject({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'How many registers are marked?' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'school_attendance_today', arguments: '{"institutionId":"x"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"marked":3,"of":4}' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'school_attendance_today',
            description: 'Registers marked today',
            parameters: tools[0]!.input_schema,
          },
        },
      ],
    });
    expect(turn).toMatchObject({
      text: '3 of 4 marked.',
      stop: 'end',
      toolUses: [],
      usage: { input: 120, output: 8 },
    });
  });

  it('turns tool calls into tool uses the gateway can run', async () => {
    const model = openaiModel({
      apiKey: 'sk-test-0000000000000000',
      fetch: fakeFetch(
        {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_9',
                    type: 'function',
                    function: {
                      name: 'school_attendance_today',
                      arguments: '{"institutionId":"i1"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 12 },
        },
        [],
      ),
    });
    const turn = await model.respond({
      system: '',
      tools,
      messages: [{ role: 'user', content: 'attendance?' }],
    });
    expect(turn.stop).toBe('tool_use');
    expect(turn.toolUses).toEqual([
      { id: 'call_9', name: 'school_attendance_today', input: { institutionId: 'i1' } },
    ]);
    // The assistant turn is kept in the shared shape, so the next request can replay it.
    expect(turn.assistant).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_9',
          name: 'school_attendance_today',
          input: { institutionId: 'i1' },
        },
      ],
    });
  });

  it('reports a refusal, a cut-off answer, and a failed request', async () => {
    const answer = (msg: unknown, finish: string) =>
      openaiModel({
        apiKey: 'sk-test-0000000000000000',
        fetch: fakeFetch(
          {
            choices: [{ finish_reason: finish, message: msg }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          },
          [],
        ),
      }).respond({ system: '', tools: [], messages: [{ role: 'user', content: 'x' }] });
    expect((await answer({ role: 'assistant', content: null, refusal: 'No.' }, 'stop')).stop).toBe(
      'refusal',
    );
    expect((await answer({ role: 'assistant', content: 'Half an ans' }, 'length')).stop).toBe(
      'max_tokens',
    );
    const failing = openaiModel({
      apiKey: 'sk-test-0000000000000000',
      fetch: (async () =>
        new Response('{"error":{"message":"bad key"}}', {
          status: 401,
        })) as unknown as typeof fetch,
    });
    await expect(
      failing.respond({ system: '', tools: [], messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/401/);
  });
});
