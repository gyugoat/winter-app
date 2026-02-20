/// Message mode prefixes injected before user messages.
/// Mirrors oh-my-opencode plugin behavior for enhanced agent workflows.

use serde::{Deserialize, Serialize};

/// Available message modes for controlling agent behavior.
/// Each mode prepends a specific prefix to the user's message before sending to OpenCode.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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
                MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:\n\
                - explore agents (codebase patterns, file structures, ast-grep)\n\
                - librarian agents (remote repos, official docs, GitHub examples)\n\
                Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)\n\
                NEVER stop at first result - be exhaustive.",
            ),
            Self::Analyze => Some(
                "[analyze-mode]\n\
                ANALYSIS MODE. Gather context before diving deep:\n\
                \n\
                CONTEXT GATHERING (parallel):\n\
                - 1-2 explore agents (codebase patterns, implementations)\n\
                - 1-2 librarian agents (if external library involved)\n\
                - Direct tools: Grep, AST-grep, LSP for targeted searches\n\
                \n\
                IF COMPLEX - DO NOT STRUGGLE ALONE. Consult specialists:\n\
                - **Oracle**: Conventional problems (architecture, debugging, complex logic)\n\
                - **Artistry**: Non-conventional problems (different approach needed)\n\
                \n\
                SYNTHESIZE findings before proceeding.",
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
