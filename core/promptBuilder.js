// core/promptBuilder.js
// Constructs the system prompt and user message for LLM calls.

const TONE_GUIDES = {
  professional: 'Use a professional, polished tone. Be clear, concise, and authoritative.',
  casual: 'Use a relaxed, conversational tone. Be friendly and approachable.',
  witty: 'Use a witty, clever tone. Add humor and personality while staying on topic.',
  direct: 'Use a direct, no-nonsense tone. Be straightforward and to the point.'
};

const TASK_INSTRUCTIONS = {
  reply: 'Write a reply to the post or comment provided in the context below.',
  comment: 'Write a comment on the post provided in the context below. Add a new perspective or real-world example, do not just summarize.',
  post: 'Write a new original post based on the topic or draft provided in the context. Make it structured and engaging.',
  rewrite: 'Rewrite and improve the text provided in the context below. Improve clarity without changing the core meaning.',
  expand: 'Expand on the ideas in the text provided in the context below. Add more detail and depth.',
  summarize: 'Summarize the post or text provided in the context below concisely.'
};

/**
 * Build the messages array for an LLM call.
 * @param {{ platform: string, task: string, tone: string, context: { postText?: string, author?: string, nearbyComments?: string[], selectedText?: string }, personality: string }} params
 * @returns {{ messages: Array<{role: string, content: string}>, maxTokens: number }}
 */
export function buildPrompt({ platform, task, tone, context, personality }) {
  const toneGuide = TONE_GUIDES[tone] || TONE_GUIDES.professional;
  const taskInstruction = TASK_INSTRUCTIONS[task] || TASK_INSTRUCTIONS.reply;

  const systemLines = [
    'You are Social AI Copilot, an intelligent writing assistant embedded in a social media platform.',
    '',
    'Platform: ' + platform,
    personality,
    '',
    'Task: ' + taskInstruction,
    '',
    'Tone: ' + toneGuide,
    '',
    'Rules:',
    '- Write ONLY the response text. Do not add prefixes like "Response:" or "Here is your reply:".',
    '- Do not include any meta-commentary about the task.',
    '- Match the language of the input context. If the context is in Spanish, reply in Spanish.',
    '- Keep the response appropriate for the platform and its typical content length.',
    '- If context includes a specific question, answer it directly.',
    '- Do not make up facts or quotes that are not in the provided context.',
    '- No hashtags unless explicitly requested.',
    '- No emojis unless the tone is casual.',
    '- Write with a slightly imperfect human tone. Avoid robotic phrasing.',
    '- Never use filler phrases like "As a...", "In my opinion...", or "Great post!"'
  ];
  const systemMessage = systemLines.join('\n');

  const userParts = [];

  if (context.selectedText) {
    userParts.push('Selected/highlighted text:\n"""\n' + context.selectedText + '\n"""');
  }

  if (context.postText) {
    userParts.push('Original post content:\n"""\n' + context.postText + '\n"""');
  }

  if (context.author) {
    userParts.push('Author: ' + context.author);
  }

  if (context.nearbyComments && context.nearbyComments.length > 0) {
    const commentLines = context.nearbyComments.map((c, i) => (i + 1) + '. ' + c).join('\n');
    userParts.push('Nearby comments for context:\n' + commentLines);
  }

  if (userParts.length === 0) {
    userParts.push('No specific context was detected. Write a helpful response based on the task and tone instructions.');
  }

  const userMessage = userParts.join('\n\n');

  let maxTokens = 300;
  if (platform === 'x') maxTokens = 280;
  if (task === 'post' || task === 'expand') maxTokens = 500;
  if (task === 'summarize') maxTokens = 150;

  return {
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ],
    maxTokens
  };
}
