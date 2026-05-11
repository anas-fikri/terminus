#[derive(Debug, Clone, Copy)]
pub enum AiState {
    Loading,
    Working,
    Thinking,
    Streaming,
    Done,
    Error,
}

impl AiState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Loading => "loading",
            Self::Working => "working",
            Self::Thinking => "thinking",
            Self::Streaming => "streaming",
            Self::Done => "done",
            Self::Error => "error",
        }
    }
}
