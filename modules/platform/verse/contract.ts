// Public API of Verse AI as a use case: asking, with the switch, budget, tool selection and log.
// The mechanism (tools, gateway, models) lives in packages/verse-ai; each module defines its tools.
export {
  askVerse,
  confirmAction,
  conversation,
  conversations,
  dismissAction,
  verseUsage,
  VerseError,
  type ActionCard,
  type ConversationTurn,
  type VerseAnswer,
  type VerseDeps,
} from './application/ask.js';
