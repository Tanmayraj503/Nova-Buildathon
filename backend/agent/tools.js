// Tool declarations passed to the Gemini API's function calling. Uses
// `parametersJsonSchema` (plain JSON Schema, lowercase types) rather than
// `parameters` (which expects Google's own uppercase Schema enum, e.g.
// type: 'OBJECT') — parametersJsonSchema is mutually exclusive with
// `parameters` and accepts standard JSON Schema shapes directly. Keep
// descriptions explicit — they are the primary steering mechanism for
// when/how the model decides to call each function.

export const tools = [
  {
    name: 'search_catalog',
    description:
      'Search the store product catalog by keyword (matches name, description, or category). ' +
      'Leave "query" empty to list the entire catalog. Returns price in INR (rupees, human-readable) ' +
      'and current stock for each product. Always use this before recommending or ordering a product ' +
      'so prices and stock are accurate and never guessed.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword, e.g. "keyboard" or "monitor". Omit or leave empty to list everything.',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_razorpay_order',
    description:
      'Create a real Razorpay Sandbox payment order for a purchase and persist it as a pending order. ' +
      'Only call this after the user has (1) explicitly chosen a specific product and quantity, and ' +
      '(2) explicitly typed out a full shipping address in the conversation — never assume, infer, or ' +
      'invent an address. This tool enforces server-side guardrails and will return a structured error ' +
      '(ADDRESS_REQUIRED, SPEND_LIMIT_EXCEEDED, or OUT_OF_STOCK) if a rule is violated; explain the ' +
      'specific error back to the user in plain language rather than retrying blindly.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        product_id: {
          type: 'integer',
          description: 'The id of the product to purchase, as returned by search_catalog.',
        },
        quantity: {
          type: 'integer',
          description: 'Number of units to order. Defaults to 1 if not specified by the user.',
        },
        shipping_address: {
          type: 'string',
          description: 'The full shipping address exactly as explicitly provided by the user in chat.',
        },
        user_id: {
          type: 'string',
          description: 'Identifier for the user placing the order (passed through from the request context).',
        },
      },
      required: ['product_id', 'quantity', 'shipping_address', 'user_id'],
    },
  },
];
