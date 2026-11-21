// Shapes of the product pages' English text (the public system and module pages).
import type { SystemKey } from '../../lib/systems';

export type ModuleContent = {
  /** One sentence under the module's name. */
  tagline: string;
  overview: string;
  /** What you can do: title and explanation. */
  capabilities: [string, string][];
  /** How it works, in order. */
  steps: [string, string][];
  /** Who uses it and what for. */
  roles: [string, string][];
  /** Rules the module keeps for you. */
  guardrails: string[];
  /** Module keys it works with. */
  related: string[];
};

export type SystemContent = {
  headline: string;
  overview: string;
  /** What the system gives an institution. */
  outcomes: [string, string][];
  /** The journey through the system, in order. */
  journey: [string, string][];
  /** Who works in it. */
  roles: string[];
  /** How it hands work to other systems. */
  connects: [SystemKey, string][];
  /** India-specific rules it follows (empty when none apply). */
  india: string[];
};
