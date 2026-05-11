use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use terminus_core::config::{ensure_app_config_exists, resolve_effective_config};
use terminus_core::monitoring;
use terminus_core::runtime;
use terminus_core::state::AiState;

#[derive(Debug, Parser)]
#[command(name = "terminus", version, about = "Dynamic AI runtime CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Ask {
        prompt: String,
        #[arg(long)]
        workspace: Option<PathBuf>,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        api_key: Option<String>,
        #[arg(long, default_value_t = true)]
        cache: bool,
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
    Monitor {
        #[arg(long)]
        workspace: Option<PathBuf>,
    },
    Git {
        subcommand: String,
        #[arg(long)]
        workspace: Option<PathBuf>,
    },
    InitConfig,
    Decisions,
}

fn workspace_or_current(input: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = input {
        return Ok(path);
    }
    std::env::current_dir().context("failed resolving current workspace directory")
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Ask {
            prompt,
            workspace,
            model,
            api_key,
            cache,
            dry_run,
        } => {
            let workspace = workspace_or_current(workspace)?;
            let cfg = resolve_effective_config(&workspace)?;

            if dry_run {
                println!("state=loading");
                println!("state=working");
                println!("state=thinking");
                println!("state=streaming");
                println!("state=done");
                println!(
                    "\n--- response ---\n[dry-run] provider={} model={} prompt_chars={}",
                    cfg.provider_name,
                    model.as_deref().unwrap_or(&cfg.provider.model),
                    prompt.chars().count()
                );
                return Ok(());
            }

            let response = runtime::ask(
                &workspace,
                &cfg,
                &prompt,
                model.as_deref(),
                api_key.as_deref(),
                None, // base_url_override
                cache,
                |state| print_state(state),
            )
            .await?;

            println!("\n--- response ---\n{}", response.content);
            println!(
                "\nfrom_cache={}, est_input_tokens={}, est_output_tokens={}",
                response.from_cache, response.estimated_input_tokens, response.estimated_output_tokens
            );
        }
        Commands::Monitor { workspace } => {
            let workspace = workspace_or_current(workspace)?;
            let summary = monitoring::read_summary(&workspace)?;
            println!("runs={}", summary.total_runs);
            println!("cache_hits={}", summary.cache_hits);
            println!("input_tokens={}", summary.total_input_tokens);
            println!("output_tokens={}", summary.total_output_tokens);
        }
        Commands::Git {
            subcommand,
            workspace,
        } => {
            let workspace = workspace_or_current(workspace)?;
            let cfg = resolve_effective_config(&workspace)?;

            if cfg.git_mode != "read-only" && cfg.git_mode != "full" {
                anyhow::bail!("invalid git_mode={}, expected read-only|full", cfg.git_mode);
            }

            let out = terminus_core::gitops::run_git(
                &workspace,
                &subcommand,
                cfg.git_mode == "read-only",
            )?;
            println!("{}", out);
        }
        Commands::InitConfig => {
            let path = ensure_app_config_exists()?;
            println!("app config ready at {}", path.display());
        }
        Commands::Decisions => {
            println!("semantic_cache_engine=local-simhash");
            println!("monitoring_retention_days=30");
            println!("mcp_default_policy=confirm");
            println!("community_skill_governance=signed-manifest-curated");
            println!("git_scope_default=read-only");
        }
    }

    Ok(())
}

fn print_state(state: AiState) {
    println!("state={}", state.as_str());
}
