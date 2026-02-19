/// Message mode prefixes injected before user messages.
/// Mirrors oh-my-opencode plugin behavior for enhanced agent workflows.

use serde::{Deserialize, Serialize};

/// Available message modes for controlling agent behavior.
/// Each mode prepends a specific prefix to the user's message before sending to OpenCode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageMode {
    /// No prefix — sends the message as-is.
    Normal,
    /// Activates search mode: maximizes web search effort and synthesis.
    Search,
    /// Activates analysis mode: deep investigation with structured output.
    Analyze,
}

impl MessageMode {
    /// Returns the prefix text to prepend to user messages, or `None` for Normal mode.
    pub fn prefix(&self) -> Option<&'static str> {
        match self {
            Self::Normal => None,
            Self::Search => Some(
                "[search-mode]\n\
                MAXIMIZE SEARCH EFFORT. You MUST use web search tools extensively.\n\
                - Search for multiple angles on the topic\n\
                - Cross-reference sources\n\
                - Synthesize findings into a comprehensive answer\n\
                - Always cite sources with URLs\n\
                - If first search insufficient, search again with different terms\n\
                Do NOT answer from memory alone. SEARCH FIRST.",
            ),
            Self::Analyze => Some(
                "[analyze-mode]\n\
                ANALYSIS MODE. Perform deep, structured investigation.\n\
                - Break the problem into components\n\
                - Examine each component systematically\n\
                - Identify patterns, anomalies, and root causes\n\
                - Consider multiple hypotheses before concluding\n\
                - Output: structured analysis with clear sections\n\
                Think step by step. Show your reasoning.",
            ),
        }
    }

    /// Applies this mode's prefix to the given content string.
    /// Returns the original content unchanged for Normal mode.
    pub fn apply(&self, content: &str) -> String {
        match self.prefix() {
            Some(prefix) => format!("{}\n\n{}", prefix, content),
            None => content.to_string(),
        }
    }
}
